import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CompileAdapter,
  type CompileInput,
  type CompileResult,
  validateCompileInput,
} from "../../services/compile.js";

const DEFAULT_DOCKER_IMAGE = "texlive/texlive:latest-small";

type DockerCompileAdapterOptions = {
  dockerImage?: string;
};

export function createDockerCompileAdapter(
  options?: DockerCompileAdapterOptions,
): CompileAdapter {
  const dockerImage = options?.dockerImage ?? DEFAULT_DOCKER_IMAGE;

  return {
    compile: (input) => runCompile(dockerImage, input),
  };
}

async function runCompile(
  dockerImage: string,
  input: CompileInput,
): Promise<CompileResult> {
  validateCompileInput(input);

  const tmpDir = join(tmpdir(), `collabtex-compile-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  const containerName = `collabtex-compile-${randomUUID()}`;

  try {
    await writeInputFiles(tmpDir, input.files);

    const args = [
      "run",
      "--name",
      containerName,
      "--network",
      "none",
      "-v",
      `${tmpDir}:/work`,
      "-w",
      "/work",
      dockerImage,
      "pdflatex",
      "-interaction=nonstopmode",
      `./${input.mainFile}`,
    ];

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), input.timeoutMs);

    try {
      const { exitCode, logs } = await execFilePromise("docker", args, {
        signal: abortController.signal,
      });

      return { outcome: "completed", exitCode, logs };
    } catch (error) {
      if (isAbortError(error)) {
        await killContainer(containerName);
        const logs = await getContainerLogs(containerName);
        return { outcome: "timeout", logs };
      }

      if (isDockerNotFoundError(error)) {
        throw new Error("Docker is not installed or not available on PATH", {
          cause: error,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await removeContainer(containerName);
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(
        `Failed to clean up temp directory ${tmpDir}:`,
        cleanupError,
      );
    }
  }
}

async function writeInputFiles(
  tmpDir: string,
  files: Map<string, string>,
): Promise<void> {
  for (const [relativePath, content] of files) {
    const filePath = resolve(tmpDir, relativePath);
    const rel = relative(tmpDir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`File path escapes working directory: ${relativePath}`);
    }
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

function execFilePromise(
  command: string,
  args: string[],
  options: { signal: AbortSignal },
): Promise<{ exitCode: number; logs: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { signal: options.signal, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const logs = stdout + stderr;

        if (options.signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }

        if (error && isAbortError(error)) {
          reject(error);
          return;
        }

        if (error && "code" in error && typeof error.code === "number") {
          resolve({ exitCode: error.code, logs });
          return;
        }

        if (error) {
          reject(error);
          return;
        }

        resolve({ exitCode: 0, logs });
      },
    );

    options.signal.addEventListener(
      "abort",
      () => {
        child.kill("SIGKILL");
      },
      { once: true },
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isDockerNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function killContainer(containerName: string): Promise<void> {
  await new Promise<void>((res) => {
    execFile("docker", ["kill", containerName], (error) => {
      if (error) {
        console.error(`Failed to kill container ${containerName}:`, error);
      }
      res();
    });
  });
}

async function getContainerLogs(containerName: string): Promise<string> {
  return new Promise<string>((res) => {
    execFile("docker", ["logs", containerName], (error, stdout, stderr) => {
      if (error) {
        res("(failed to retrieve container logs)");
        return;
      }
      res(stdout + stderr);
    });
  });
}

async function removeContainer(containerName: string): Promise<void> {
  await new Promise<void>((res) => {
    execFile("docker", ["rm", "-f", containerName], (error) => {
      if (error) {
        console.error(`Failed to remove container ${containerName}:`, error);
      }
      res();
    });
  });
}
