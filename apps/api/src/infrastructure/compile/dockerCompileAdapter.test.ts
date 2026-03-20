import { describe, expect, it } from "vitest";
import { createDockerCompileAdapter } from "./dockerCompileAdapter.js";

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
