import { describe, expect, it } from "vitest";
import { createDockerCompileAdapter } from "./dockerCompileAdapter.js";

describe("dockerCompileAdapter input validation", () => {
  const adapter = createDockerCompileAdapter();

  it("rejects mainFile with ../ traversal", async () => {
    const files = new Map([["../escape.tex", "content"]]);
    await expect(
      adapter.compile({ files, mainFile: "../escape.tex", timeoutMs: 5000 }),
    ).rejects.toThrow("mainFile path escapes working directory");
  });

  it("rejects mainFile with absolute path", async () => {
    const files = new Map([["/etc/passwd", "content"]]);
    await expect(
      adapter.compile({ files, mainFile: "/etc/passwd", timeoutMs: 5000 }),
    ).rejects.toThrow("mainFile path escapes working directory");
  });

  it("rejects mainFile not present in files map", async () => {
    const files = new Map([["other.tex", "content"]]);
    await expect(
      adapter.compile({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).rejects.toThrow('mainFile "main.tex" is not in the provided files');
  });

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

  it("rejects mainFile with nested ../ traversal", async () => {
    const files = new Map([["sub/../../escape.tex", "content"]]);
    await expect(
      adapter.compile({
        files,
        mainFile: "sub/../../escape.tex",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("mainFile path escapes working directory");
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
