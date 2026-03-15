import { describe, expect, it, vi } from "vitest";
import { createCollaborationService } from "./collaboration.js";
import type { StoredDocument } from "./document.js";
import type { DocumentTextStateRepository } from "./currentTextState.js";
import type { ProjectStateRepository } from "../repositories/projectStateRepository.js";
import {
  InvalidSnapshotDataError,
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
    });

    repository.listForProject.mockResolvedValue([snapshot]);
    store.readProjectSnapshot.mockResolvedValue({
      version: 2,
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

  it("captures snapshots from current text state and carries forward binary bytes", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository: createProjectStateRepository(),
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
      version: 2,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          textContent: "\\section{Old}",
        },
        "document-2": {
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
          binaryContentBase64: "AQID",
        },
      },
    });
    documentTextStateRepository.findByDocumentId.mockImplementation(
      async (documentId) => {
        if (documentId !== "document-1") {
          return null;
        }

        return {
          documentId,
          yjsState: Uint8Array.from([]),
          textContent: "\\section{Live}",
          version: 5,
          createdAt: new Date("2026-03-01T12:00:00.000Z"),
          updatedAt: new Date("2026-03-01T12:00:00.000Z"),
        };
      },
    );

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

    expect(store.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        version: 2,
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
            binaryContentBase64: "AQID",
          },
        },
      },
    );
  });

  it("restores a snapshot, writes a checkpoint, and emits resets after commit", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const documentTextStateRepository = createDocumentTextStateRepository();
    const projectStateRepository = createProjectStateRepository();
    const resetPublisher = createResetPublisher();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
      documentTextStateRepository,
      collaborationService: createCollaborationService(),
      projectStateRepository,
      resetPublisher,
    });
    const targetSnapshot = createStoredSnapshot();

    repository.findById.mockResolvedValue(targetSnapshot);
    store.readProjectSnapshot.mockResolvedValue({
      version: 2,
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
      affectedTextDocumentIds: ["document-1", "deleted-text-doc"],
    });

    const restored = await service.restoreProjectSnapshot({
      projectId: "project-1",
      snapshotId: "snapshot-1",
      actorUserId: "user-1",
    });

    expect(store.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        version: 2,
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
    expect(resetPublisher.emitDocumentReset).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      documentId: "document-1",
      reason: "snapshot_restore",
    });
    expect(resetPublisher.emitDocumentReset).toHaveBeenNthCalledWith(2, {
      projectId: "project-1",
      documentId: "deleted-text-doc",
      reason: "snapshot_restore",
    });
    expect(restored.id).toBe("snapshot-2");
  });

  it("rejects malformed snapshot payloads", () => {
    expect(() =>
      parseProjectSnapshotState({
        version: 1,
        documents: {},
      }),
    ).toThrow(new InvalidSnapshotDataError("snapshot version must be 2"));

    expect(() =>
      parseProjectSnapshotState({
        version: 2,
        documents: {
          "document-1": {
            path: "/same.tex",
            kind: "text",
            mime: null,
            textContent: "one",
          },
          "document-2": {
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
  return {
    findByDocumentId: vi.fn<DocumentTextStateRepository["findByDocumentId"]>(),
    create: vi.fn<DocumentTextStateRepository["create"]>(),
    update: vi.fn<DocumentTextStateRepository["update"]>(),
  };
}

function createProjectStateRepository() {
  return {
    restoreProjectState: vi.fn<ProjectStateRepository["restoreProjectState"]>(),
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
