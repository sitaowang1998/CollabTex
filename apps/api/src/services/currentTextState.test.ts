import { describe, expect, it, vi } from "vitest";
import { createCollaborationService } from "./collaboration.js";
import type { StoredDocument } from "./document.js";
import type { SnapshotService } from "./snapshot.js";
import {
  createCurrentTextStateService,
  DocumentTextStateAlreadyExistsError,
  DocumentTextStateDocumentNotFoundError,
  DocumentTextStateVersionConflictError,
  DocumentTextStateVersionRequiredError,
  type CurrentTextStateService,
  type DocumentTextStateRepository,
  type StoredDocumentTextState,
  UnsupportedCurrentTextStateDocumentError,
} from "./currentTextState.js";

describe("current text state service", () => {
  it("returns an existing current-state row without reading snapshots", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    const existing = createStoredDocumentTextState();
    repository.findByDocumentId.mockResolvedValue(existing);
    const snapshotService = createSnapshotServiceDouble();
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService,
      collaborationService: createCollaborationService(),
    });

    await expect(
      service.loadOrHydrate(createStoredDocument()),
    ).resolves.toEqual(existing);
    expect(snapshotService.loadDocumentContent).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("hydrates from snapshot content once when no current-state row exists", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    repository.findByDocumentId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        createStoredDocumentTextState({
          textContent: "\\section{Hydrated}",
        }),
      );
    repository.create.mockImplementation(async (input) =>
      createStoredDocumentTextState({
        documentId: input.documentId,
        yjsState: input.yjsState,
        textContent: input.textContent,
      }),
    );
    const snapshotService = createSnapshotServiceDouble();
    snapshotService.loadDocumentContent.mockResolvedValue(
      "\\section{Hydrated}",
    );
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService,
      collaborationService: createCollaborationService(),
    });

    const hydrated = await service.loadOrHydrate(createStoredDocument());
    const hydratedDocument =
      createCollaborationService().createDocumentFromUpdate(hydrated.yjsState);

    try {
      expect(hydrated.textContent).toBe("\\section{Hydrated}");
      expect(hydrated.version).toBe(1);
      expect(hydratedDocument.getText()).toBe("\\section{Hydrated}");
      expect(snapshotService.loadDocumentContent).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledTimes(1);
    } finally {
      hydratedDocument.destroy();
    }
  });

  it("hydrates empty text when snapshots have no usable content", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    repository.findByDocumentId.mockResolvedValue(null);
    repository.create.mockImplementation(async (input) =>
      createStoredDocumentTextState({
        documentId: input.documentId,
        yjsState: input.yjsState,
        textContent: input.textContent,
      }),
    );
    const snapshotService = createSnapshotServiceDouble();
    snapshotService.loadDocumentContent.mockResolvedValue(null);
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService,
      collaborationService: createCollaborationService(),
    });

    await expect(
      service.loadOrHydrate(createStoredDocument()),
    ).resolves.toMatchObject({
      textContent: "",
      version: 1,
    });
  });

  it("re-reads the persisted row when concurrent hydration created it first", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    const existing = createStoredDocumentTextState({
      textContent: "\\section{Existing}",
    });
    repository.findByDocumentId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    repository.create.mockRejectedValue(
      new DocumentTextStateAlreadyExistsError(),
    );
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService: createSnapshotServiceDouble({
        loadDocumentContent: vi.fn().mockResolvedValue("\\section{Hydrated}"),
      }),
      collaborationService: createCollaborationService(),
    });

    await expect(
      service.loadOrHydrate(createStoredDocument()),
    ).resolves.toEqual(existing);
  });

  it("rejects binary documents during hydration", async () => {
    const service = createCurrentTextStateService({
      documentTextStateRepository: createDocumentTextStateRepositoryDouble(),
      snapshotService: createSnapshotServiceDouble(),
      collaborationService: createCollaborationService(),
    });

    await expect(
      service.loadOrHydrate(createStoredDocument({ kind: "binary" })),
    ).rejects.toBeInstanceOf(UnsupportedCurrentTextStateDocumentError);
  });

  it("persists edits without reading snapshots", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    repository.update.mockImplementation(async (input) =>
      createStoredDocumentTextState({
        documentId: input.documentId,
        yjsState: input.yjsState,
        textContent: input.textContent,
        version: 5,
      }),
    );
    const snapshotService = createSnapshotServiceDouble();
    const collaborationService = createCollaborationService();
    const currentDocument =
      collaborationService.createDocumentFromText("Draft v2");
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService,
      collaborationService,
    });

    try {
      await expect(
        service.persist({
          documentId: "document-1",
          document: currentDocument,
          expectedVersion: 4,
        }),
      ).resolves.toMatchObject({
        textContent: "Draft v2",
        version: 5,
      });
      expect(snapshotService.loadDocumentContent).not.toHaveBeenCalled();
      expect(repository.findByDocumentId).not.toHaveBeenCalled();
    } finally {
      currentDocument.destroy();
    }
  });

  it("rejects persistence without an expected version", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    const document =
      createCollaborationService().createDocumentFromText("Text");
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService: createSnapshotServiceDouble(),
      collaborationService: createCollaborationService(),
    });

    try {
      await expect(
        service.persist({
          documentId: "document-1",
          document,
        } as Parameters<CurrentTextStateService["persist"]>[0]),
      ).rejects.toBeInstanceOf(DocumentTextStateVersionRequiredError);
      expect(repository.update).not.toHaveBeenCalled();
    } finally {
      document.destroy();
    }
  });

  it("raises a version conflict when an explicit CAS write misses", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    repository.update.mockResolvedValue(null);
    const document =
      createCollaborationService().createDocumentFromText("Text");
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService: createSnapshotServiceDouble(),
      collaborationService: createCollaborationService(),
    });

    try {
      await expect(
        service.persist({
          documentId: "document-1",
          document,
          expectedVersion: 2,
        }),
      ).rejects.toBeInstanceOf(DocumentTextStateVersionConflictError);
    } finally {
      document.destroy();
    }
  });

  it("propagates missing current-state rows from the repository", async () => {
    const repository = createDocumentTextStateRepositoryDouble();
    repository.update.mockRejectedValue(
      new DocumentTextStateDocumentNotFoundError(),
    );
    const document =
      createCollaborationService().createDocumentFromText("Text");
    const service = createCurrentTextStateService({
      documentTextStateRepository: repository,
      snapshotService: createSnapshotServiceDouble(),
      collaborationService: createCollaborationService(),
    });

    try {
      await expect(
        service.persist({
          documentId: "document-1",
          document,
          expectedVersion: 2,
        }),
      ).rejects.toBeInstanceOf(DocumentTextStateDocumentNotFoundError);
    } finally {
      document.destroy();
    }
  });
});

function createDocumentTextStateRepositoryDouble(
  overrides: Partial<DocumentTextStateRepository> = {},
): {
  findByDocumentId: ReturnType<
    typeof vi.fn<DocumentTextStateRepository["findByDocumentId"]>
  >;
  create: ReturnType<typeof vi.fn<DocumentTextStateRepository["create"]>>;
  update: ReturnType<typeof vi.fn<DocumentTextStateRepository["update"]>>;
} {
  return {
    findByDocumentId: vi.fn<DocumentTextStateRepository["findByDocumentId"]>(),
    create: vi.fn<DocumentTextStateRepository["create"]>(),
    update: vi.fn<DocumentTextStateRepository["update"]>(),
    ...overrides,
  };
}

function createSnapshotServiceDouble(
  overrides: Partial<SnapshotService> = {},
): SnapshotService {
  return {
    loadDocumentContent: vi.fn<SnapshotService["loadDocumentContent"]>(),
    captureProjectSnapshot: vi.fn<SnapshotService["captureProjectSnapshot"]>(),
    ...overrides,
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

function createStoredDocumentTextState(
  overrides: Partial<StoredDocumentTextState> = {},
): StoredDocumentTextState {
  return {
    documentId: "document-1",
    yjsState: Uint8Array.from([]),
    textContent: "Draft",
    version: 1,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
