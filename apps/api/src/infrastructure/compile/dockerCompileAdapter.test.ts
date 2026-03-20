import { type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockerCompileAdapter } from "./dockerCompileAdapter.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { execFile } = await import("node:child_process");
const mockedExecFile = vi.mocked(execFile);

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
    ).rejects.toThrow("File path escapes working directory");
  });

  it("rejects file map key with absolute path", async () => {
    const files = new Map([
      ["main.tex", "content"],
      ["/etc/shadow", "malicious"],
    ]);
    await expect(
      adapter.compile({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).rejects.toThrow("File path escapes working directory");
  });

  it("rejects file map key with nested ../ traversal", async () => {
    const files = new Map([
      ["main.tex", "content"],
      ["sub/../../outside.tex", "malicious"],
    ]);
    await expect(
      adapter.compile({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).rejects.toThrow("File path escapes working directory");
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
