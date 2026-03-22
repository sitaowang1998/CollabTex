import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DocumentRepository, StoredDocument } from "./document.js";
import type { DocumentTextStateRepository } from "./currentTextState.js";
import {
  BinaryContentNotFoundError,
  type BinaryContentStore,
} from "./binaryContent.js";
import type {
  SnapshotRepository,
  SnapshotStore,
  StoredSnapshot,
} from "./snapshot.js";
import {
  createWorkspaceExportService,
  type WorkspaceWriter,
} from "./workspaceExport.js";
import { createLocalWorkspaceWriter } from "../infrastructure/workspace/localWorkspaceWriter.js";

describe("workspace export service", () => {
  it("exports text files with content from DocumentTextState", async () => {
    const { service, documentTextStateRepository } = createTestService();
    documentTextStateRepository.findByDocumentIds.mockResolvedValue([
      createTextState("doc-1", "\\documentclass{article}"),
    ]);

    const result = await service.exportWorkspace("project-1");

    try {
      const content = await readFile(
        join(result.directory, "main.tex"),
        "utf8",
      );
      expect(content).toBe("\\documentclass{article}");
    } finally {
      await result.cleanup();
    }
  });

  it("falls back to snapshot text content when DocumentTextState is missing", async () => {
    const { service, snapshotRepository, snapshotStore } = createTestService();
    snapshotRepository.listForProject.mockResolvedValue([
      createStoredSnapshot(),
    ]);
    snapshotStore.readProjectSnapshot.mockResolvedValue({
      version: 2,
      documents: {
        "doc-1": {
          path: "/main.tex",
          kind: "text",
          mime: "text/x-tex",
          textContent: "\\section{From Snapshot}",
        },
      },
    });

    const result = await service.exportWorkspace("project-1");

    try {
      const content = await readFile(
        join(result.directory, "main.tex"),
        "utf8",
      );
      expect(content).toBe("\\section{From Snapshot}");
    } finally {
      await result.cleanup();
    }
  });

  it("writes empty text file when no content source exists", async () => {
    const { service } = createTestService();

    const result = await service.exportWorkspace("project-1");

    try {
      const content = await readFile(
        join(result.directory, "main.tex"),
        "utf8",
      );
      expect(content).toBe("");
    } finally {
      await result.cleanup();
    }
  });

  it("exports binary files from the mutable store", async () => {
    const { service, documentRepository, binaryContentStore } =
      createTestService();
    const binaryContent = Buffer.from("PNG image bytes");
    documentRepository.listForProject.mockResolvedValue([
      createStoredDocument({
        id: "bin-1",
        path: "/figures/diagram.png",
        kind: "binary",
      }),
    ]);
    binaryContentStore.get.mockResolvedValue(binaryContent);

    const result = await service.exportWorkspace("project-1");

    try {
      const bytes = await readFile(
        join(result.directory, "figures", "diagram.png"),
      );
      expect(bytes).toEqual(binaryContent);
      expect(binaryContentStore.get).toHaveBeenCalledWith("project-1/bin-1");
    } finally {
      await result.cleanup();
    }
  });

  it("falls back to snapshot binary when mutable store has no content", async () => {
    const {
      service,
      documentRepository,
      binaryContentStore,
      snapshotRepository,
      snapshotStore,
    } = createTestService();
    const binaryContent = Buffer.from("PNG image bytes");
    documentRepository.listForProject.mockResolvedValue([
      createStoredDocument({
        id: "bin-1",
        path: "/figures/diagram.png",
        kind: "binary",
      }),
    ]);
    binaryContentStore.get.mockRejectedValue(new BinaryContentNotFoundError());
    snapshotRepository.listForProject.mockResolvedValue([
      createStoredSnapshot(),
    ]);
    snapshotStore.readProjectSnapshot.mockResolvedValue({
      version: 2,
      documents: {
        "bin-1": {
          path: "/figures/diagram.png",
          kind: "binary",
          mime: "image/png",
          binaryContentBase64: binaryContent.toString("base64"),
        },
      },
    });

    const result = await service.exportWorkspace("project-1");

    try {
      const bytes = await readFile(
        join(result.directory, "figures", "diagram.png"),
      );
      expect(bytes).toEqual(binaryContent);
    } finally {
      await result.cleanup();
    }
  });

  it("skips binary files with no content in store or snapshot", async () => {
    const { service, documentRepository, binaryContentStore } =
      createTestService();
    documentRepository.listForProject.mockResolvedValue([
      createStoredDocument({
        id: "bin-1",
        path: "/figures/diagram.png",
        kind: "binary",
      }),
    ]);
    binaryContentStore.get.mockRejectedValue(new BinaryContentNotFoundError());

    const result = await service.exportWorkspace("project-1");

    try {
      expect(existsSync(join(result.directory, "figures", "diagram.png"))).toBe(
        false,
      );
    } finally {
      await result.cleanup();
    }
  });

  it("mirrors canonical path structure in directory layout", async () => {
    const { service, documentRepository, documentTextStateRepository } =
      createTestService();
    documentRepository.listForProject.mockResolvedValue([
      createStoredDocument({ id: "doc-1", path: "/main.tex" }),
      createStoredDocument({ id: "doc-2", path: "/chapters/intro.tex" }),
      createStoredDocument({ id: "doc-3", path: "/chapters/body.tex" }),
    ]);
    documentTextStateRepository.findByDocumentIds.mockResolvedValue([
      createTextState("doc-1", "root"),
      createTextState("doc-2", "intro"),
      createTextState("doc-3", "body"),
    ]);

    const result = await service.exportWorkspace("project-1");

    try {
      expect(await readFile(join(result.directory, "main.tex"), "utf8")).toBe(
        "root",
      );
      expect(
        await readFile(join(result.directory, "chapters", "intro.tex"), "utf8"),
      ).toBe("intro");
      expect(
        await readFile(join(result.directory, "chapters", "body.tex"), "utf8"),
      ).toBe("body");
    } finally {
      await result.cleanup();
    }
  });

  it("cleans up temp directory on cleanup call", async () => {
    const { service } = createTestService();

    const result = await service.exportWorkspace("project-1");
    const dir = result.directory;

    expect(existsSync(dir)).toBe(true);
    await result.cleanup();
    expect(existsSync(dir)).toBe(false);
  });

  it("handles project with no documents", async () => {
    const { service, documentRepository } = createTestService();
    documentRepository.listForProject.mockResolvedValue([]);

    const result = await service.exportWorkspace("project-1");

    try {
      const dirStat = await stat(result.directory);
      expect(dirStat.isDirectory()).toBe(true);
      const entries = await readdir(result.directory);
      expect(entries).toEqual([]);
    } finally {
      await result.cleanup();
    }
  });

  it("rejects documents with path traversal attempts", async () => {
    const { service, documentRepository } = createTestService();
    documentRepository.listForProject.mockResolvedValue([
      createStoredDocument({
        id: "doc-1",
        path: "/../../etc/passwd",
      }),
    ]);

    await expect(service.exportWorkspace("project-1")).rejects.toThrow(
      /escapes export directory/,
    );
  });

  it("propagates writer errors to caller", async () => {
    const failingWriter: WorkspaceWriter = {
      writeWorkspace: vi.fn().mockRejectedValue(new Error("disk full")),
    };
    const service = createWorkspaceExportService({
      documentRepository: createDocumentRepository(),
      documentTextStateRepository: createDocumentTextStateRepository(),
      snapshotRepository: createSnapshotRepository(),
      snapshotStore: createSnapshotStore(),
      binaryContentStore: createBinaryContentStore(),
      workspaceWriter: failingWriter,
    });

    await expect(service.exportWorkspace("project-1")).rejects.toThrow(
      "disk full",
    );
  });
});

function createTestService() {
  const documentRepository = createDocumentRepository();
  const documentTextStateRepository = createDocumentTextStateRepository();
  const snapshotRepository = createSnapshotRepository();
  const snapshotStore = createSnapshotStore();
  const binaryContentStore = createBinaryContentStore();

  const service = createWorkspaceExportService({
    documentRepository,
    documentTextStateRepository,
    snapshotRepository,
    snapshotStore,
    binaryContentStore,
    workspaceWriter: createLocalWorkspaceWriter(),
  });

  return {
    service,
    documentRepository,
    documentTextStateRepository,
    snapshotRepository,
    snapshotStore,
    binaryContentStore,
  };
}

function createDocumentRepository() {
  const listForProject = vi.fn<DocumentRepository["listForProject"]>();
  listForProject.mockResolvedValue([
    createStoredDocument({ id: "doc-1", path: "/main.tex", kind: "text" }),
  ]);

  return { listForProject };
}

function createDocumentTextStateRepository() {
  const findByDocumentIds =
    vi.fn<DocumentTextStateRepository["findByDocumentIds"]>();
  findByDocumentIds.mockResolvedValue([]);

  return { findByDocumentIds };
}

function createSnapshotRepository() {
  const listForProject = vi.fn<SnapshotRepository["listForProject"]>();
  listForProject.mockResolvedValue([]);

  return { listForProject };
}

function createSnapshotStore() {
  return {
    readProjectSnapshot: vi.fn<SnapshotStore["readProjectSnapshot"]>(),
  };
}

function createBinaryContentStore() {
  return {
    get: vi.fn<BinaryContentStore["get"]>(),
  };
}

function createStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id: "doc-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text",
    mime: null,
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createStoredSnapshot(
  overrides: Partial<StoredSnapshot> = {},
): StoredSnapshot {
  return {
    id: "snapshot-1",
    projectId: "project-1",
    storagePath: "project-1/existing.json",
    message: null,
    authorId: "user-1",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createTextState(documentId: string, textContent: string) {
  return {
    documentId,
    yjsState: Uint8Array.from([]),
    textContent,
    version: 1,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
  };
}
