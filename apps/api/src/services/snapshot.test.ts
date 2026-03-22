import { describe, expect, it, vi } from "vitest";
import { createCollaborationService } from "./collaboration.js";
import type { DocumentRepository, StoredDocument } from "./document.js";
import type { DocumentTextStateRepository } from "./currentTextState.js";
import type { ProjectStateRepository } from "../repositories/projectStateRepository.js";
import {
  BinaryContentNotFoundError,
  type BinaryContentStore,
} from "./binaryContent.js";
import {
  InvalidSnapshotDataError,
  SnapshotDataNotFoundError,
  createSnapshotService,
  parseProjectSnapshotState,
  type SnapshotRepository,
  type SnapshotResetPublisher,
  type SnapshotStore,
  type StoredSnapshot,
} from "./snapshot.js";

describe("snapshot service", () => {
  it("loads text content from current text state before checking snapshots", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    documentTextStateRepository.findByDocumentId.mockResolvedValue({
      documentId: "document-1",
      yjsState: Uint8Array.from([]),
      textContent: "\\section{Current}",
      version: 3,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    });
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore: createBinaryContentStore(),
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    await expect(
      service.loadDocumentContent(createStoredDocument()),
    ).resolves.toBe("\\section{Current}");
    expect(repository.listForProject).not.toHaveBeenCalled();
  });

  it("falls back to the latest snapshot when current text state is missing", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const snapshot = createStoredSnapshot();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore: createBinaryContentStore(),
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.listForProject.mockResolvedValue([snapshot]);
    store.readProjectSnapshot.mockResolvedValue({
      commentThreads: [],
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: "text/x-tex",
          textContent: "\\section{Snapshot}",
        },
      },
    });

    await expect(
      service.loadDocumentContent(createStoredDocument()),
    ).resolves.toBe("\\section{Snapshot}");
  });

  it("falls back to an older readable snapshot when the newest blob is missing", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore: createBinaryContentStore(),
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.listForProject.mockResolvedValue([
      createStoredSnapshot({
        id: "snapshot-2",
        storagePath: "project-1/latest.json",
      }),
      createStoredSnapshot({
        id: "snapshot-1",
        storagePath: "project-1/older.json",
      }),
    ]);
    store.readProjectSnapshot
      .mockRejectedValueOnce(new SnapshotDataNotFoundError())
      .mockResolvedValueOnce({
        commentThreads: [],
        documents: {
          "document-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            textContent: "\\section{Recovered}",
          },
        },
      });

    await expect(
      service.loadDocumentContent(createStoredDocument()),
    ).resolves.toBe("\\section{Recovered}");
    expect(store.readProjectSnapshot).toHaveBeenNthCalledWith(
      1,
      "project-1/latest.json",
    );
    expect(store.readProjectSnapshot).toHaveBeenNthCalledWith(
      2,
      "project-1/older.json",
    );
  });

  it("captures binary content from the mutable store", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const binaryContentStore = createBinaryContentStore();
    const binaryContent = Buffer.from([1, 2, 3]);
    binaryContentStore.get.mockResolvedValue(binaryContent);
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore,
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.listForProject.mockResolvedValue([]);
    repository.createSnapshot.mockImplementation(async (input) => ({
      id: "snapshot-2",
      projectId: input.projectId,
      storagePath: input.storagePath,
      message: input.message,
      authorId: input.authorId,
      createdAt: new Date("2026-03-02T00:00:00.000Z"),
    }));
    documentTextStateRepository.findByDocumentIds.mockResolvedValue([
      {
        documentId: "document-1",
        yjsState: Uint8Array.from([]),
        textContent: "\\section{Live}",
        version: 5,
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        updatedAt: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);

    await service.captureProjectSnapshot({
      projectId: "project-1",
      authorId: "user-1",
      documents: [
        createStoredDocument(),
        createStoredDocument({
          id: "document-2",
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
        }),
      ],
    });

    expect(binaryContentStore.get).toHaveBeenCalledWith("project-1/document-2");
    expect(store.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        commentThreads: [],
        documents: {
          "document-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            textContent: "\\section{Live}",
          },
          "document-2": {
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
            binaryContentBase64: binaryContent.toString("base64"),
          },
        },
      },
    );
  });

  it("falls back to previous snapshot binary when mutable store has no content", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const binaryContentStore = createBinaryContentStore();
    binaryContentStore.get.mockRejectedValue(new BinaryContentNotFoundError());
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore,
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.listForProject.mockResolvedValue([createStoredSnapshot()]);
    repository.createSnapshot.mockImplementation(async (input) => ({
      id: "snapshot-2",
      projectId: input.projectId,
      storagePath: input.storagePath,
      message: input.message,
      authorId: input.authorId,
      createdAt: new Date("2026-03-02T00:00:00.000Z"),
    }));
    store.readProjectSnapshot.mockResolvedValue({
      commentThreads: [],
      documents: {
        "document-2": {
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
          binaryContentBase64: "AQID",
        },
      },
    });
    documentTextStateRepository.findByDocumentIds.mockResolvedValue([]);

    await service.captureProjectSnapshot({
      projectId: "project-1",
      authorId: "user-1",
      documents: [
        createStoredDocument({
          id: "document-2",
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
        }),
      ],
    });

    expect(store.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        commentThreads: [],
        documents: {
          "document-2": {
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
            binaryContentBase64: "AQID",
          },
        },
      },
    );
  });

  it("captures from the newest readable snapshot when the latest blob is unreadable", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const binaryContentStore = createBinaryContentStore();
    binaryContentStore.get.mockRejectedValue(new BinaryContentNotFoundError());
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore,
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.listForProject.mockResolvedValue([
      createStoredSnapshot({
        id: "snapshot-2",
        storagePath: "project-1/latest.json",
      }),
      createStoredSnapshot({
        id: "snapshot-1",
        storagePath: "project-1/older.json",
      }),
    ]);
    repository.createSnapshot.mockImplementation(async (input) => ({
      id: "snapshot-3",
      projectId: input.projectId,
      storagePath: input.storagePath,
      message: input.message,
      authorId: input.authorId,
      createdAt: new Date("2026-03-03T00:00:00.000Z"),
    }));
    documentTextStateRepository.findByDocumentIds.mockResolvedValue([]);
    store.readProjectSnapshot
      .mockRejectedValueOnce(new InvalidSnapshotDataError("invalid snapshot"))
      .mockResolvedValueOnce({
        commentThreads: [],
        documents: {
          "document-2": {
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
            binaryContentBase64: "AQID",
          },
        },
      });

    await service.captureProjectSnapshot({
      projectId: "project-1",
      authorId: "user-1",
      documents: [
        createStoredDocument({
          id: "document-2",
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
        }),
      ],
    });

    expect(store.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        commentThreads: [],
        documents: {
          "document-2": {
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
            binaryContentBase64: "AQID",
          },
        },
      },
    );
    expect(documentTextStateRepository.findByDocumentIds).toHaveBeenCalledWith(
      [],
    );
  });

  it("restores a snapshot, writes a checkpoint, syncs binary store, and emits resets", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const projectStateRepository = createProjectStateRepository();
    const resetPublisher = createResetPublisher();
    const binaryContentStore = createBinaryContentStore();
    const documentLookup = createDocumentLookup();
    documentLookup.listForProject.mockResolvedValue([
      createStoredDocument(),
      createStoredDocument({
        id: "document-2",
        path: "/figure.png",
        kind: "binary",
        mime: "image/png",
      }),
      createStoredDocument({
        id: "document-3",
        path: "/old-image.png",
        kind: "binary",
        mime: "image/png",
      }),
    ]);
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository,
      binaryContentStore,
      documentLookup,
      commentThreadLookup: createCommentThreadLookup(),
      getResetPublisher: () => resetPublisher,
    });
    const targetSnapshot = createStoredSnapshot();

    repository.findById.mockResolvedValue(targetSnapshot);
    store.readProjectSnapshot.mockResolvedValue({
      commentThreads: [],
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          textContent: "\\section{Restored}",
        },
        "document-2": {
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
          binaryContentBase64: "AQID",
        },
      },
    });
    projectStateRepository.restoreProjectState.mockResolvedValue({
      snapshot: createStoredSnapshot({
        id: "snapshot-2",
        storagePath: "project-1/restored.json",
      }),
      affectedTextDocuments: [
        {
          documentId: "document-1",
          serverVersion: 3,
        },
        {
          documentId: "deleted-text-doc",
          serverVersion: 0,
        },
      ],
    });

    const restored = await service.restoreProjectSnapshot({
      projectId: "project-1",
      snapshotId: "snapshot-1",
      actorUserId: "user-1",
    });

    expect(store.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        commentThreads: [],
        documents: {
          "document-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            textContent: "\\section{Restored}",
          },
          "document-2": {
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
            binaryContentBase64: "AQID",
          },
        },
      },
    );
    expect(projectStateRepository.restoreProjectState).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        actorUserId: "user-1",
        restoredDocuments: [
          expect.objectContaining({
            documentId: "document-1",
            path: "/main.tex",
            kind: "text",
            textContent: "\\section{Restored}",
            yjsState: expect.any(Uint8Array),
          }),
          expect.objectContaining({
            documentId: "document-2",
            path: "/figure.png",
            kind: "binary",
            textContent: null,
            yjsState: null,
          }),
        ],
      }),
    );
    expect(binaryContentStore.put).toHaveBeenCalledTimes(1);
    expect(binaryContentStore.put).toHaveBeenCalledWith(
      "project-1/document-2",
      Buffer.from("AQID", "base64"),
    );
    expect(binaryContentStore.delete).toHaveBeenCalledTimes(1);
    expect(binaryContentStore.delete).toHaveBeenCalledWith(
      "project-1/document-3",
    );
    expect(resetPublisher.emitDocumentReset).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      documentId: "document-1",
      reason: "snapshot_restore",
      serverVersion: 3,
    });
    expect(resetPublisher.emitDocumentReset).toHaveBeenNthCalledWith(2, {
      projectId: "project-1",
      documentId: "deleted-text-doc",
      reason: "snapshot_restore",
      serverVersion: 0,
    });
    expect(restored.id).toBe("snapshot-2");
  });

  it("propagates unexpected errors from the binary content store during capture", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const binaryContentStore = createBinaryContentStore();
    binaryContentStore.get.mockRejectedValue(new Error("storage timeout"));
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
      binaryContentStore,
      documentLookup: createDocumentLookup(),
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.listForProject.mockResolvedValue([]);
    documentTextStateRepository.findByDocumentIds.mockResolvedValue([]);

    await expect(
      service.captureProjectSnapshot({
        projectId: "project-1",
        authorId: "user-1",
        documents: [
          createStoredDocument({
            id: "document-2",
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
          }),
        ],
      }),
    ).rejects.toThrow("storage timeout");
  });

  it("succeeds and logs error when binary put fails during restore", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const projectStateRepository = createProjectStateRepository();
    const binaryContentStore = createBinaryContentStore();
    binaryContentStore.put.mockRejectedValue(new Error("disk full"));
    const documentLookup = createDocumentLookup();
    documentLookup.listForProject.mockResolvedValue([]);
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository,
      binaryContentStore,
      documentLookup,
      commentThreadLookup: createCommentThreadLookup(),
    });

    repository.findById.mockResolvedValue(createStoredSnapshot());
    store.readProjectSnapshot.mockResolvedValue({
      commentThreads: [],
      documents: {
        "document-2": {
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
          binaryContentBase64: "AQID",
        },
      },
    });
    projectStateRepository.restoreProjectState.mockResolvedValue({
      snapshot: createStoredSnapshot({ id: "snapshot-2" }),
      affectedTextDocuments: [],
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const restored = await service.restoreProjectSnapshot({
        projectId: "project-1",
        snapshotId: "snapshot-1",
        actorUserId: "user-1",
      });

      expect(restored.id).toBe("snapshot-2");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "1 binary file(s) failed to write to the content store",
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects malformed or unsupported snapshot payloads", () => {
    expect(() =>
      parseProjectSnapshotState({
        documents: {
          "11111111-1111-1111-1111-111111111111": {
            path: "/same.tex",
            kind: "text",
            mime: null,
            textContent: "one",
          },
          "22222222-2222-2222-2222-222222222222": {
            path: "/same.tex",
            kind: "text",
            mime: null,
            textContent: "two",
          },
        },
      }),
    ).toThrow(
      new InvalidSnapshotDataError("snapshot document paths must be unique"),
    );

    expect(() =>
      parseProjectSnapshotState({
        commentThreads: [],
        documents: {
          "not-a-uuid": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            textContent: "body",
          },
        },
      }),
    ).toThrow(
      new InvalidSnapshotDataError("snapshot document id must be a valid UUID"),
    );

    expect(() =>
      parseProjectSnapshotState({
        commentThreads: [],
        documents: {
          "11111111-1111-1111-1111-111111111111": {
            path: "docs/main.tex",
            kind: "text",
            mime: null,
            textContent: "body",
          },
        },
      }),
    ).toThrow(
      new InvalidSnapshotDataError(
        "snapshot document path must be a canonical absolute path",
      ),
    );

    expect(() =>
      parseProjectSnapshotState({
        commentThreads: [],
        documents: {
          "11111111-1111-1111-1111-111111111111": {
            path: "/docs",
            kind: "text",
            mime: null,
            textContent: "folder-file-conflict",
          },
          "22222222-2222-2222-2222-222222222222": {
            path: "/docs/a.tex",
            kind: "text",
            mime: null,
            textContent: "descendant",
          },
        },
      }),
    ).toThrow(
      new InvalidSnapshotDataError(
        "snapshot document paths must not contain file/descendant conflicts",
      ),
    );
  });
});

function createSnapshotRepository() {
  return {
    listForProject: vi.fn<SnapshotRepository["listForProject"]>(),
    findById: vi.fn<SnapshotRepository["findById"]>(),
    createSnapshot: vi.fn<SnapshotRepository["createSnapshot"]>(),
  };
}

function createSnapshotStore() {
  return {
    readProjectSnapshot: vi.fn<SnapshotStore["readProjectSnapshot"]>(),
    writeProjectSnapshot: vi.fn<SnapshotStore["writeProjectSnapshot"]>(),
  };
}

function createDocumentTextStateRepository() {
  const findByDocumentIds =
    vi.fn<DocumentTextStateRepository["findByDocumentIds"]>();
  findByDocumentIds.mockResolvedValue([]);

  return {
    findByDocumentId: vi.fn<DocumentTextStateRepository["findByDocumentId"]>(),
    findByDocumentIds,
    create: vi.fn<DocumentTextStateRepository["create"]>(),
    update: vi.fn<DocumentTextStateRepository["update"]>(),
  };
}

function createProjectStateRepository() {
  return {
    restoreProjectState: vi.fn<ProjectStateRepository["restoreProjectState"]>(),
  };
}

function createBinaryContentStore() {
  return {
    get: vi.fn<BinaryContentStore["get"]>(),
    put: vi.fn<BinaryContentStore["put"]>(),
    delete: vi.fn<BinaryContentStore["delete"]>(),
  };
}

function createDocumentLookup() {
  const listForProject = vi.fn<DocumentRepository["listForProject"]>();
  listForProject.mockResolvedValue([]);

  return { listForProject };
}

function createCommentThreadLookup() {
  return {
    listThreadsForProject: vi.fn().mockResolvedValue([]),
  };
}

function createResetPublisher() {
  return {
    emitDocumentReset: vi.fn<SnapshotResetPublisher["emitDocumentReset"]>(),
  };
}

function createStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id: "document-1",
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
