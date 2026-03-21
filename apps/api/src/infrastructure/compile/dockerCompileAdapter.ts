import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
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

  let dockerNotFound = false;

  try {
    await writeInputFiles(tmpDir, input.files);

    if (!process.getuid || !process.getgid) {
      throw new Error(
        "Docker compilation requires a POSIX environment (process.getuid/getgid unavailable)",
      );
    }

    const args = [
      "run",
      "--name",
      containerName,
      "--network",
      "none",
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "--memory",
      "512m",
      "--pids-limit",
      "100",
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

      const pdfContent = await tryReadPdf(tmpDir, input.mainFile);

      return {
        outcome: "completed" as const,
        exitCode,
        logs,
        ...(pdfContent != null ? { pdfContent } : {}),
      };
    } catch (error) {
      if (isAbortError(error)) {
        await killContainer(containerName);
        const logs = await getContainerLogs(containerName);
        return { outcome: "timeout", logs };
      }

      if (isDockerNotFoundError(error)) {
        dockerNotFound = true;
        throw new Error("Docker is not installed or not available on PATH", {
          cause: error,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (!dockerNotFound) {
      await removeContainer(containerName);
    }
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
    if (
      rel === "" ||
      rel === "." ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\") ||
      isAbsolute(rel)
    ) {
      throw new Error(`File path escapes working directory: ${relativePath}`);
    }
    await mkdir(dirname(filePath), { recursive: true });
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
        console.error(
          `Failed to retrieve logs for container ${containerName}:`,
          error,
        );
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

function derivePdfPath(mainFile: string): string {
  const base = basename(mainFile);
  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1) return base + ".pdf";

  return base.slice(0, lastDot) + ".pdf";
}

async function tryReadPdf(
  tmpDir: string,
  mainFile: string,
): Promise<Buffer | undefined> {
  const pdfPath = join(tmpDir, derivePdfPath(mainFile));

  try {
    return await readFile(pdfPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  }
}
