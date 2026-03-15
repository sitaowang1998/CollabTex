import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalFilesystemSnapshotStore } from "./localFilesystemSnapshotStore.js";
import {
  InvalidSnapshotDataError,
  SnapshotDataNotFoundError,
} from "../../services/snapshot.js";

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
      version: 2,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          textContent: "\\section{Stored}",
        },
      },
    });

    await expect(
      store.readProjectSnapshot("project-1/one.json"),
    ).resolves.toEqual({
      version: 2,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          textContent: "\\section{Stored}",
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

  it("maps invalid JSON snapshot files to InvalidSnapshotDataError", async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), "collabtex-snapshots-"));
    const store = createLocalFilesystemSnapshotStore(rootDirectory);

    await mkdir(path.join(rootDirectory, "project-1"), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDirectory, "project-1", "invalid.json"),
      "{not-json",
      "utf8",
    );

    await expect(
      store.readProjectSnapshot("project-1/invalid.json"),
    ).rejects.toBeInstanceOf(InvalidSnapshotDataError);
  });

  it("rejects paths that escape the storage root", async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), "collabtex-snapshots-"));
    const store = createLocalFilesystemSnapshotStore(rootDirectory);

    await expect(
      store.writeProjectSnapshot("../escape.json", {
        version: 2,
        documents: {},
      }),
    ).rejects.toThrow(
      "Snapshot storage path must stay within the storage root",
    );
  });
});
