import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { CompileArtifactNotFoundError } from "../../services/compile.js";
import { createLocalFilesystemCompileStore } from "./localFilesystemCompileStore.js";

describe("localFilesystemCompileStore", () => {
  const testRoots: string[] = [];

  function createTestRoot(): string {
    const root = join(tmpdir(), `collabtex-compile-test-${randomUUID()}`);
    testRoots.push(root);

    return root;
  }

  afterEach(async () => {
    for (const root of testRoots) {
      await rm(root, { recursive: true, force: true });
    }
    testRoots.length = 0;
  });

  it("writes and reads a PDF round-trip", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemCompileStore(root);
    const content = Buffer.from("%PDF-1.4 test content");
    const storagePath = "project-1/output.pdf";

    await store.writePdf(storagePath, content);
    const result = await store.readPdf(storagePath);

    expect(result).toEqual(content);
  });

  it("creates nested directories on write", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemCompileStore(root);
    const storagePath = "a/b/c/output.pdf";

    await store.writePdf(storagePath, Buffer.from("pdf"));

    expect(existsSync(join(root, "a", "b", "c", "output.pdf"))).toBe(true);
  });

  it("throws CompileArtifactNotFoundError for missing file", async () => {
    const root = createTestRoot();
    await mkdir(root, { recursive: true });
    const store = createLocalFilesystemCompileStore(root);

    await expect(store.readPdf("nonexistent.pdf")).rejects.toThrow(
      CompileArtifactNotFoundError,
    );
  });

  it("rejects path traversal on write", () => {
    const root = createTestRoot();
    const store = createLocalFilesystemCompileStore(root);

    expect(
      store.writePdf("../../etc/passwd", Buffer.from("bad")),
    ).rejects.toThrow(/must stay within the storage root/);
  });

  it("rejects path traversal on read", () => {
    const root = createTestRoot();
    const store = createLocalFilesystemCompileStore(root);

    expect(store.readPdf("../../../etc/passwd")).rejects.toThrow(
      /must stay within the storage root/,
    );
  });

  it("re-throws non-ENOENT errors from readPdf", async () => {
    const root = createTestRoot();
    // Create a directory at the path where a file is expected
    const dirPath = join(root, "project-1", "output.pdf");
    await mkdir(dirPath, { recursive: true });
    const store = createLocalFilesystemCompileStore(root);

    // Reading a directory as a file throws EISDIR, not ENOENT
    await expect(
      store.readPdf("project-1/output.pdf"),
    ).rejects.not.toBeInstanceOf(CompileArtifactNotFoundError);
  });

  it("overwrites existing file on write", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemCompileStore(root);
    const storagePath = "project-1/output.pdf";

    await store.writePdf(storagePath, Buffer.from("version 1"));
    await store.writePdf(storagePath, Buffer.from("version 2"));

    const result = await readFile(join(root, storagePath));
    expect(result.toString()).toBe("version 2");
  });
});
