import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CompileAdapter,
  CompileInput,
  CompileResult,
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
  const tmpDir = join(tmpdir(), `collabtex-compile-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    await writeInputFiles(tmpDir, input.files);

    const containerName = `collabtex-compile-${randomUUID()}`;
    const args = [
      "run",
      "--rm",
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
      input.mainFile,
    ];

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), input.timeoutMs);

    try {
      const { exitCode, logs } = await execFilePromise("docker", args, {
        signal: abortController.signal,
      });

      return { success: exitCode === 0, exitCode, logs, timedOut: false };
    } catch (error) {
      if (isAbortError(error)) {
        await killContainer(containerName);
        return { success: false, exitCode: null, logs: "", timedOut: true };
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
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

async function killContainer(containerName: string): Promise<void> {
  await new Promise<void>((res) => {
    execFile("docker", ["kill", containerName], (error) => {
      if (error) {
        console.error(
          `Failed to kill container ${containerName}: ${error.message}`,
        );
      }
      res();
    });
  });

  await new Promise<void>((res) => {
    execFile("docker", ["rm", "-f", containerName], (error) => {
      if (error) {
        console.error(
          `Failed to remove container ${containerName}: ${error.message}`,
        );
      }
      res();
    });
  });
}
