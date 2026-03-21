import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BinaryContentNotFoundError } from "../../services/binaryContent.js";
import { createLocalFilesystemBinaryContentStore } from "./localFilesystemBinaryContentStore.js";

describe("localFilesystemBinaryContentStore", () => {
  const testRoots: string[] = [];

  function createTestRoot(): string {
    const root = join(
      tmpdir(),
      `collabtex-binary-content-test-${randomUUID()}`,
    );
    testRoots.push(root);

    return root;
  }

  afterEach(async () => {
    for (const root of testRoots) {
      await rm(root, { recursive: true, force: true });
    }
    testRoots.length = 0;
  });

  it("writes and reads a binary file round-trip", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const storagePath = "project-1/document-1";

    await store.put(storagePath, content);
    const result = await store.get(storagePath);

    expect(result).toEqual(content);
  });

  it("creates nested directories on put", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);
    const storagePath = "a/b/c/file";

    await store.put(storagePath, Buffer.from("data"));
    const result = await store.get(storagePath);

    expect(result.toString()).toBe("data");
  });

  it("throws BinaryContentNotFoundError for missing file", async () => {
    const root = createTestRoot();
    await mkdir(root, { recursive: true });
    const store = createLocalFilesystemBinaryContentStore(root);

    await expect(store.get("nonexistent")).rejects.toThrow(
      BinaryContentNotFoundError,
    );
  });

  it("overwrites existing file on put", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);
    const storagePath = "project-1/document-1";

    await store.put(storagePath, Buffer.from("version 1"));
    await store.put(storagePath, Buffer.from("version 2"));

    const result = await store.get(storagePath);
    expect(result.toString()).toBe("version 2");
  });

  it("deletes existing file", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);
    const storagePath = "project-1/document-1";

    await store.put(storagePath, Buffer.from("data"));
    await store.delete(storagePath);

    await expect(store.get(storagePath)).rejects.toThrow(
      BinaryContentNotFoundError,
    );
  });

  it("delete does not throw for missing file", async () => {
    const root = createTestRoot();
    await mkdir(root, { recursive: true });
    const store = createLocalFilesystemBinaryContentStore(root);

    await expect(store.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("rejects path traversal on put", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);

    await expect(
      store.put("../../etc/passwd", Buffer.from("bad")),
    ).rejects.toThrow(/must stay within the storage root/);
  });

  it("rejects path traversal on get", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);

    await expect(store.get("../../../etc/passwd")).rejects.toThrow(
      /must stay within the storage root/,
    );
  });

  it("rejects path traversal on delete", async () => {
    const root = createTestRoot();
    const store = createLocalFilesystemBinaryContentStore(root);

    await expect(store.delete("../../etc/passwd")).rejects.toThrow(
      /must stay within the storage root/,
    );
  });

  it("re-throws non-ENOENT errors from get", async () => {
    const root = createTestRoot();
    const dirPath = join(root, "project-1", "document-1");
    await mkdir(dirPath, { recursive: true });
    const store = createLocalFilesystemBinaryContentStore(root);

    await expect(store.get("project-1/document-1")).rejects.not.toBeInstanceOf(
      BinaryContentNotFoundError,
    );
  });
});
