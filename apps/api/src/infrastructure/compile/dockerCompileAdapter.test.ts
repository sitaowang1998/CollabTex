import { type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockerCompileAdapter } from "./dockerCompileAdapter.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { execFile } = await import("node:child_process");
const mockedExecFile = vi.mocked(execFile);
const { readFile } = await import("node:fs/promises");
const mockedReadFile = vi.mocked(readFile);

function validInput() {
  return {
    files: new Map([
      [
        "main.tex",
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
      ],
    ]),
    mainFile: "main.tex",
    timeoutMs: 5000,
  };
}

/**
 * Resolves the callback from an execFile call that may use either
 * the 3-arg `(cmd, args, cb)` or 4-arg `(cmd, args, opts, cb)` signature.
 */
function getCallback(args: unknown[]): (...cbArgs: unknown[]) => void {
  const last = args[args.length - 1];
  if (typeof last === "function") return last as (...cbArgs: unknown[]) => void;
  throw new Error("execFile mock: no callback found");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dockerCompileAdapter writeInputFiles safety", () => {
  const adapter = createDockerCompileAdapter();

  it("rejects file map key with ../ traversal", async () => {
    const files = new Map([
      ["main.tex", "content"],
      ["../outside.tex", "malicious"],
    ]);
    await expect(
      adapter.compile({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).rejects.toThrow("Invalid file path");
  });

  it("rejects file map key with absolute path", async () => {
    const files = new Map([
      ["main.tex", "content"],
      ["/etc/shadow", "malicious"],
    ]);
    await expect(
      adapter.compile({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).rejects.toThrow("Invalid file path");
  });

  it("rejects file map key with nested ../ traversal", async () => {
    const files = new Map([
      ["main.tex", "content"],
      ["sub/../../outside.tex", "malicious"],
    ]);
    await expect(
      adapter.compile({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).rejects.toThrow("Invalid file path");
  });
});

describe("dockerCompileAdapter successful compilation", () => {
  const adapter = createDockerCompileAdapter();

  it("returns completed with exit code 0 on success", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.4\n");
    mockedReadFile.mockResolvedValueOnce(pdfBuffer as never);

    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const cb = getCallback(args);
      const cmd = args[1] as string[];
      if (cmd[0] === "run") {
        cb(null, "pdflatex output", "pdflatex stderr");
      } else {
        cb(null, "", "");
      }
      return { kill: vi.fn() } as unknown as ChildProcess;
    });

    const result = await adapter.compile(validInput());

    expect(result).toEqual({
      outcome: "completed",
      exitCode: 0,
      logs: "pdflatex outputpdflatex stderr",
      pdfContent: pdfBuffer,
    });

    // Verify the docker run args on the first call (the "run" invocation)
    const firstCall = mockedExecFile.mock.calls[0];
    const dockerArgs = firstCall[1] as string[];
    expect(dockerArgs).toContain("run");
    expect(dockerArgs).toContain("--network");
    expect(dockerArgs).toContain("none");
    expect(dockerArgs).toContain("--user");
    expect(dockerArgs).toContain("--memory");
    expect(dockerArgs).toContain("512m");
    expect(dockerArgs).toContain("--pids-limit");
    expect(dockerArgs).toContain("100");
    expect(dockerArgs).toContain("-v");
    expect(dockerArgs).toContain("-w");
    expect(dockerArgs).toContain("/work");
    expect(dockerArgs).toContain("texlive/texlive:latest-small");
    expect(dockerArgs).toContain("pdflatex");
    expect(dockerArgs).toContain("-interaction=nonstopmode");
    expect(dockerArgs).toContain("./main.tex");
  });

  it("returns completed with non-zero exit code on compile failure", async () => {
    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const cb = getCallback(args);
      const cmd = args[1] as string[];
      if (cmd[0] === "run") {
        const error = new Error("Command failed") as Error & { code: number };
        error.code = 1;
        cb(error, "partial output", "error output");
      } else {
        cb(null, "", "");
      }
      return { kill: vi.fn() } as unknown as ChildProcess;
    });

    const result = await adapter.compile(validInput());

    expect(result).toEqual({
      outcome: "completed",
      exitCode: 1,
      logs: "partial outputerror output",
    });
  });

  it("uses custom docker image when specified", async () => {
    const capturedArgs: string[][] = [];
    const customAdapter = createDockerCompileAdapter({
      dockerImage: "custom/texlive:2024",
    });

    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const cmdArgs = args[1] as string[];
      capturedArgs.push(cmdArgs);
      const cb = getCallback(args);
      cb(null, "", "");
      return { kill: vi.fn() } as unknown as ChildProcess;
    });

    await customAdapter.compile(validInput());

    const runArgs = capturedArgs.find((a) => a[0] === "run");
    expect(runArgs).toBeDefined();
    expect(runArgs).toContain("custom/texlive:2024");
  });
});

describe("dockerCompileAdapter timeout handling", () => {
  const adapter = createDockerCompileAdapter();

  it("returns timeout outcome when compilation exceeds time limit", async () => {
    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const cmd = args[1] as string[];

      if (cmd[0] === "run") {
        // Extract the options to get the abort signal
        const opts = args[2] as { signal: AbortSignal };
        const cb = getCallback(args);

        const child = {
          kill: vi.fn(),
        } as unknown as ChildProcess;

        // When the signal aborts, invoke the callback as if aborted
        opts.signal.addEventListener("abort", () => {
          cb(
            new DOMException("The operation was aborted.", "AbortError"),
            "",
            "",
          );
        });

        return child;
      }

      if (cmd[0] === "kill") {
        const cb = getCallback(args);
        cb(null, "", "");
        return {} as ChildProcess;
      }

      if (cmd[0] === "logs") {
        const cb = getCallback(args);
        cb(null, "timeout partial logs", "");
        return {} as ChildProcess;
      }

      // rm -f (cleanup)
      const cb = getCallback(args);
      cb(null, "", "");
      return {} as ChildProcess;
    });

    // Use a very short timeout to trigger abort quickly
    const result = await adapter.compile({
      ...validInput(),
      timeoutMs: 1,
    });

    expect(result).toEqual({
      outcome: "timeout",
      logs: "timeout partial logs",
    });
  });
});

describe("dockerCompileAdapter error handling", () => {
  const adapter = createDockerCompileAdapter();

  it("throws a descriptive error when Docker is not installed", async () => {
    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const cb = getCallback(args);
      const cmd = args[1] as string[];
      if (cmd[0] === "run") {
        const error = new Error("spawn docker ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        cb(error, "", "");
      } else {
        // cleanup calls (rm -f): succeed silently
        cb(null, "", "");
      }
      return {} as ChildProcess;
    });

    await expect(adapter.compile(validInput())).rejects.toThrow(
      "Docker is not installed or not available on PATH",
    );
  });

  it("re-throws unexpected errors unmodified", async () => {
    const unexpectedError = new Error("unexpected docker failure");

    mockedExecFile.mockImplementation((...args: unknown[]) => {
      const cb = getCallback(args);
      const cmd = args[1] as string[];
      if (cmd[0] === "run") {
        cb(unexpectedError, "", "");
      } else {
        cb(null, "", "");
      }
      return {} as ChildProcess;
    });

    await expect(adapter.compile(validInput())).rejects.toThrow(
      "unexpected docker failure",
    );
  });
});
