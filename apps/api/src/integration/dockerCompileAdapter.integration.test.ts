import { describe, expect, it } from "vitest";
import { createDockerCompileAdapter } from "../infrastructure/compile/dockerCompileAdapter.js";

const adapter = createDockerCompileAdapter();

describe("docker compile adapter integration", () => {
  it(
    "compiles a valid LaTeX file successfully",
    { timeout: 120_000 },
    async () => {
      const files = new Map<string, string>();
      files.set(
        "main.tex",
        String.raw`\documentclass{article}
\begin{document}
Hello, world!
\end{document}`,
      );

      const result = await adapter.compile({
        files,
        mainFile: "main.tex",
        timeoutMs: 60_000,
      });

      expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
      expect(result.logs.length).toBeGreaterThan(0);
    },
  );

  it(
    "returns failure and logs for a broken LaTeX file",
    { timeout: 120_000 },
    async () => {
      const files = new Map<string, string>();
      files.set(
        "main.tex",
        String.raw`\documentclass{article}
\begin{document}
\undefined_command_that_does_not_exist
\end{document}`,
      );

      const result = await adapter.compile({
        files,
        mainFile: "main.tex",
        timeoutMs: 60_000,
      });

      expect(result.outcome).toBe("completed");
      if (result.outcome === "completed") {
        expect(result.exitCode).not.toBe(0);
      }
      expect(result.logs.length).toBeGreaterThan(0);
    },
  );

  it(
    "enforces timeout on an infinite-loop LaTeX file",
    { timeout: 30_000 },
    async () => {
      const files = new Map<string, string>();
      files.set(
        "main.tex",
        String.raw`\documentclass{article}
\begin{document}
\def\x{\x}\x
\end{document}`,
      );

      const result = await adapter.compile({
        files,
        mainFile: "main.tex",
        timeoutMs: 5_000,
      });

      expect(result.outcome).toBe("timeout");
    },
  );
});
