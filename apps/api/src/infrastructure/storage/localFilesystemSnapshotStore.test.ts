import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalFilesystemSnapshotStore } from "./localFilesystemSnapshotStore.js";
import { SnapshotDataNotFoundError } from "../../services/snapshot.js";

describe("local filesystem snapshot store", () => {
  let rootDirectory: string | undefined;

  afterEach(async () => {
    if (rootDirectory) {
      await rm(rootDirectory, {
        recursive: true,
        force: true,
      });
      rootDirectory = undefined;
    }
  });

  it("writes and reads snapshot blobs", async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), "collabtex-snapshots-"));
    const store = createLocalFilesystemSnapshotStore(rootDirectory);

    await store.writeProjectSnapshot("project-1/one.json", {
      version: 1,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          content: "\\section{Stored}",
        },
      },
    });

    await expect(
      store.readProjectSnapshot("project-1/one.json"),
    ).resolves.toEqual({
      version: 1,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          content: "\\section{Stored}",
        },
      },
    });
  });

  it("maps missing snapshot files to SnapshotDataNotFoundError", async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), "collabtex-snapshots-"));
    const store = createLocalFilesystemSnapshotStore(rootDirectory);

    await expect(
      store.readProjectSnapshot("project-1/missing.json"),
    ).rejects.toBeInstanceOf(SnapshotDataNotFoundError);
  });

  it("rejects paths that escape the storage root", async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), "collabtex-snapshots-"));
    const store = createLocalFilesystemSnapshotStore(rootDirectory);

    await expect(
      store.writeProjectSnapshot("../escape.json", {
        version: 1,
        documents: {},
      }),
    ).rejects.toThrow(
      "Snapshot storage path must stay within the storage root",
    );
  });
});
