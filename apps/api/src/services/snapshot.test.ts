import { describe, expect, it, vi } from "vitest";
import {
  buildProjectSnapshotState,
  createSnapshotService,
  type SnapshotRepository,
  type SnapshotStore,
  type StoredSnapshot,
} from "./snapshot.js";
import type { StoredDocument } from "./document.js";

describe("snapshot service", () => {
  it("loads text content from the latest persisted snapshot", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
    });
    const snapshot = createStoredSnapshot();

    repository.findLatestForProject.mockResolvedValue(snapshot);
    store.readProjectSnapshot.mockResolvedValue({
      version: 1,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: "text/x-tex",
          content: "\\section{Intro}",
        },
      },
    });

    await expect(
      service.loadDocumentContent(createStoredDocument()),
    ).resolves.toBe("\\section{Intro}");
    expect(store.readProjectSnapshot).toHaveBeenCalledWith(
      snapshot.storagePath,
    );
  });

  it("returns default content when no snapshot exists for a text document", async () => {
    const repository = createSnapshotRepository();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: createSnapshotStore(),
    });

    repository.findLatestForProject.mockResolvedValue(null);

    await expect(
      service.loadDocumentContent(createStoredDocument()),
    ).resolves.toBe("");
  });

  it("captures a new project snapshot with carried-forward text content", async () => {
    const repository = createSnapshotRepository();
    const store = createSnapshotStore();
    const service = createSnapshotService({
      snapshotRepository: repository,
      snapshotStore: store,
    });

    repository.findLatestForProject.mockResolvedValue(createStoredSnapshot());
    repository.createSnapshot.mockImplementation(async (input) => ({
      id: "snapshot-2",
      projectId: input.projectId,
      storagePath: input.storagePath,
      message: input.message,
      authorId: input.authorId,
      createdAt: new Date("2026-03-02T00:00:00.000Z"),
    }));
    store.readProjectSnapshot.mockResolvedValue({
      version: 1,
      documents: {
        "document-1": {
          path: "/old-name.tex",
          kind: "text",
          mime: "text/x-tex",
          content: "\\section{Carried}",
        },
      },
    });

    const created = await service.captureProjectSnapshot({
      projectId: "project-1",
      authorId: "user-1",
      documents: [
        createStoredDocument({
          path: "/renamed.tex",
        }),
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
        version: 1,
        documents: {
          "document-1": {
            path: "/renamed.tex",
            kind: "text",
            mime: null,
            content: "\\section{Carried}",
          },
          "document-2": {
            path: "/figure.png",
            kind: "binary",
            mime: "image/png",
            content: null,
          },
        },
      },
    );
    expect(created.authorId).toBe("user-1");
  });

  it("rebuilds project snapshot state from the active document list", () => {
    expect(
      buildProjectSnapshotState(
        [
          createStoredDocument({
            id: "document-1",
            path: "/main.tex",
          }),
          createStoredDocument({
            id: "document-2",
            path: "/appendix.tex",
          }),
        ],
        {
          version: 1,
          documents: {
            "document-1": {
              path: "/draft.tex",
              kind: "text",
              mime: null,
              content: "kept",
            },
            "document-3": {
              path: "/deleted.tex",
              kind: "text",
              mime: null,
              content: "deleted",
            },
          },
        },
      ),
    ).toEqual({
      version: 1,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          content: "kept",
        },
        "document-2": {
          path: "/appendix.tex",
          kind: "text",
          mime: null,
          content: "",
        },
      },
    });
  });
});

function createSnapshotRepository() {
  return {
    findLatestForProject: vi.fn<SnapshotRepository["findLatestForProject"]>(),
    createSnapshot: vi.fn<SnapshotRepository["createSnapshot"]>(),
  };
}

function createSnapshotStore() {
  return {
    readProjectSnapshot: vi.fn<SnapshotStore["readProjectSnapshot"]>(),
    writeProjectSnapshot: vi.fn<SnapshotStore["writeProjectSnapshot"]>(),
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
