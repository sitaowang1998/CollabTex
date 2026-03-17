import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  ActiveDocumentSessionInvalidatedError,
  createActiveDocumentRegistry,
  type ActiveDocumentSessionHandle,
} from "./activeDocumentRegistry.js";
import { createCollaborationService } from "./collaboration.js";
import {
  DocumentTextStateVersionConflictError,
  type CurrentTextStateService,
  type StoredDocumentTextState,
} from "./currentTextState.js";
import type { DocumentRepository, StoredDocument } from "./document.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  type ProjectAccessService,
} from "./projectAccess.js";
import {
  createRealtimeDocumentService,
  RealtimeDocumentNotFoundError,
  RealtimeDocumentSessionMismatchError,
} from "./realtimeDocument.js";
import { createDeferred } from "../test/helpers/deferred.js";

describe("realtime document service", () => {
  it("persists an accepted update and advances the active session version", async () => {
    const collaborationService = createCollaborationService();
    const documentRepository = createDocumentRepository();
    const currentTextStateService = createCurrentTextStateService();
    const service = createRealtimeDocumentService({
      collaborationService,
      projectAccessService: createProjectAccessService(),
      documentRepository,
      currentTextStateService,
    });
    const storedDocument = createStoredDocument();
    const initialState = createStoredDocumentTextState("Hello", 1);
    const persistedState = createStoredDocumentTextStateFromUpdate(
      applyMutationToState(initialState.yjsState, (document) => {
        document.getText("content").insert(5, " world");
      }),
      2,
    );

    documentRepository.findById.mockResolvedValue(storedDocument);
    currentTextStateService.persist.mockResolvedValue(persistedState);
    const sessionHandle = await createSessionHandle(initialState);

    const accepted = await service.applyUpdate({
      projectId: "project-1",
      documentId: storedDocument.id,
      userId: "user-1",
      sessionHandle,
      update: createIncrementalUpdate(initialState.yjsState, (document) => {
        document.getText("content").insert(5, " world");
      }),
      isCurrentSession: () => true,
    });

    expect(accepted).toMatchObject({
      serverVersion: 2,
    });

    expect(currentTextStateService.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: storedDocument.id,
        expectedVersion: 1,
      }),
    );
    expect(sessionHandle.session.serverVersion).toBe(2);
    expect(sessionHandle.session.document.getText()).toBe("Hello world");
    expect(
      applyUpdateToState(initialState.yjsState, accepted.acceptedUpdate),
    ).toBe("Hello world");
  });

  it("keeps accepted-context computation inside the same exclusive queue turn", async () => {
    const collaborationService = createCollaborationService();
    const documentRepository = createDocumentRepository();
    const currentTextStateService = createCurrentTextStateService();
    const service = createRealtimeDocumentService({
      collaborationService,
      projectAccessService: createProjectAccessService(),
      documentRepository,
      currentTextStateService,
    });
    const storedDocument = createStoredDocument();
    const initialState = createStoredDocumentTextState("Hello", 1);
    const firstPersistedState = createStoredDocumentTextStateFromUpdate(
      applyMutationToState(initialState.yjsState, (document) => {
        document.getText("content").insert(5, " world");
      }),
      2,
    );
    const secondPersistedState = createStoredDocumentTextStateFromUpdate(
      applyMutationToState(firstPersistedState.yjsState, (document) => {
        document.getText("content").insert(11, " again");
      }),
      3,
    );
    const firstAcceptedContextStarted = createDeferred<void>();
    const releaseFirstAcceptedContext = createDeferred<void>();

    documentRepository.findById.mockResolvedValue(storedDocument);
    currentTextStateService.persist
      .mockResolvedValueOnce(firstPersistedState)
      .mockResolvedValueOnce(secondPersistedState);
    const sessionHandle = await createSessionHandle(initialState);

    const firstUpdate = service.applyUpdate({
      projectId: "project-1",
      documentId: storedDocument.id,
      userId: "user-1",
      sessionHandle,
      update: createIncrementalUpdate(initialState.yjsState, (document) => {
        document.getText("content").insert(5, " world");
      }),
      isCurrentSession: () => true,
      buildAcceptedContext: async () => {
        firstAcceptedContextStarted.resolve();
        await releaseFirstAcceptedContext.promise;

        return { acceptedOrder: 1 };
      },
    });

    await firstAcceptedContextStarted.promise;

    const secondUpdate = service.applyUpdate({
      projectId: "project-1",
      documentId: storedDocument.id,
      userId: "user-1",
      sessionHandle,
      update: createIncrementalUpdate(
        firstPersistedState.yjsState,
        (document) => {
          document.getText("content").insert(11, " again");
        },
      ),
      isCurrentSession: () => true,
      buildAcceptedContext: () => ({ acceptedOrder: 2 }),
    });

    await Promise.resolve();

    expect(currentTextStateService.persist).toHaveBeenCalledTimes(1);

    releaseFirstAcceptedContext.resolve();

    await expect(firstUpdate).resolves.toMatchObject({
      serverVersion: 2,
      acceptedContext: { acceptedOrder: 1 },
    });
    await expect(secondUpdate).resolves.toMatchObject({
      serverVersion: 3,
      acceptedContext: { acceptedOrder: 2 },
    });
    expect(currentTextStateService.persist).toHaveBeenCalledTimes(2);
  });

  it("reloads durable state and retries when the compare-and-swap write conflicts", async () => {
    const collaborationService = createCollaborationService();
    const documentRepository = createDocumentRepository();
    const currentTextStateService = createCurrentTextStateService();
    const service = createRealtimeDocumentService({
      collaborationService,
      projectAccessService: createProjectAccessService(),
      documentRepository,
      currentTextStateService,
    });
    const storedDocument = createStoredDocument();
    const staleState = createStoredDocumentTextState("Hello", 1);
    const originalUpdate = createIncrementalUpdate(
      staleState.yjsState,
      (document) => {
        document.getText("content").insert(5, " world");
      },
    );
    const reloadedState = createStoredDocumentTextStateFromUpdate(
      applyMutationToState(staleState.yjsState, (document) => {
        document.getText("content").insert(5, " brave");
      }),
      2,
    );
    const persistedState = createStoredDocumentTextStateFromUpdate(
      applyIncrementalUpdate(reloadedState.yjsState, originalUpdate),
      3,
    );

    documentRepository.findById.mockResolvedValue(storedDocument);
    currentTextStateService.persist
      .mockRejectedValueOnce(new DocumentTextStateVersionConflictError())
      .mockResolvedValueOnce(persistedState);
    currentTextStateService.loadOrHydrate.mockResolvedValue(reloadedState);
    const sessionHandle = await createSessionHandle(staleState);

    const accepted = await service.applyUpdate({
      projectId: "project-1",
      documentId: storedDocument.id,
      userId: "user-1",
      sessionHandle,
      update: originalUpdate,
      isCurrentSession: () => true,
    });

    expect(accepted).toMatchObject({
      serverVersion: 3,
    });

    expect(currentTextStateService.persist).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedVersion: 1,
      }),
    );
    expect(currentTextStateService.persist).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedVersion: 2,
      }),
    );
    expect(sessionHandle.session.serverVersion).toBe(3);
    expect(sessionHandle.session.document.getText()).toBe(
      persistedState.textContent,
    );
    expect(
      applyUpdateToState(staleState.yjsState, accepted.acceptedUpdate),
    ).toBe(persistedState.textContent);
  });

  it("honors socket currency after queue wait", async () => {
    const sessionHandle = await createSessionHandle(
      createStoredDocumentTextState("Hello", 1),
    );
    const releaseFirstTask = createDeferred<void>();
    const currentTextStateService = createCurrentTextStateService();
    const service = createRealtimeDocumentService({
      collaborationService: createCollaborationService(),
      projectAccessService: createProjectAccessService(),
      documentRepository: createDocumentRepository(),
      currentTextStateService,
    });

    const firstTask = sessionHandle.runExclusive(async () => {
      await releaseFirstTask.promise;
    });
    let isCurrentSession = true;
    const pendingUpdate = service.applyUpdate({
      projectId: "project-1",
      documentId: "document-1",
      userId: "user-1",
      sessionHandle,
      update: createIncrementalUpdate(
        createStoredDocumentTextState("Hello", 1).yjsState,
        (document) => {
          document.getText("content").insert(5, " world");
        },
      ),
      isCurrentSession: () => isCurrentSession,
    });

    isCurrentSession = false;
    releaseFirstTask.resolve();
    await firstTask;

    await expect(pendingUpdate).rejects.toBeInstanceOf(
      RealtimeDocumentSessionMismatchError,
    );
    expect(currentTextStateService.persist).not.toHaveBeenCalled();
  });

  it("rejects updates from an invalidated active session", async () => {
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationService(),
      loadInitialDocumentState: async () => ({
        kind: "yjs-update",
        update: createStoredDocumentTextState("Hello", 1).yjsState,
        serverVersion: 1,
      }),
      persistOnIdle: async () => {},
    });
    const sessionHandle = await registry.join({
      projectId: "project-1",
      documentId: "document-1",
    });
    const currentTextStateService = createCurrentTextStateService();
    const service = createRealtimeDocumentService({
      collaborationService: createCollaborationService(),
      projectAccessService: createProjectAccessService(),
      documentRepository: createDocumentRepository({
        findById: vi.fn().mockResolvedValue(createStoredDocument()),
      }),
      currentTextStateService,
    });

    registry.invalidate({
      projectId: "project-1",
      documentId: "document-1",
    });

    await expect(
      service.applyUpdate({
        projectId: "project-1",
        documentId: "document-1",
        userId: "user-1",
        sessionHandle,
        update: createIncrementalUpdate(
          createStoredDocumentTextState("Hello", 1).yjsState,
          (document) => {
            document.getText("content").insert(5, " world");
          },
        ),
        isCurrentSession: () => true,
      }),
    ).rejects.toBeInstanceOf(ActiveDocumentSessionInvalidatedError);

    expect(currentTextStateService.persist).not.toHaveBeenCalled();
  });

  it("honors role revocation during queue wait", async () => {
    const sessionHandle = await createSessionHandle(
      createStoredDocumentTextState("Hello", 1),
    );
    const releaseFirstTask = createDeferred<void>();
    const projectAccessService = createProjectAccessService();
    const service = createRealtimeDocumentService({
      collaborationService: createCollaborationService(),
      projectAccessService,
      documentRepository: createDocumentRepository({
        findById: vi.fn().mockResolvedValue(createStoredDocument()),
      }),
      currentTextStateService: createCurrentTextStateService(),
    });

    const firstTask = sessionHandle.runExclusive(async () => {
      await releaseFirstTask.promise;
    });
    projectAccessService.requireProjectRole.mockRejectedValueOnce(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );
    const pendingUpdate = service.applyUpdate({
      projectId: "project-1",
      documentId: "document-1",
      userId: "user-1",
      sessionHandle,
      update: createIncrementalUpdate(
        createStoredDocumentTextState("Hello", 1).yjsState,
        (document) => {
          document.getText("content").insert(5, " world");
        },
      ),
      isCurrentSession: () => true,
    });

    releaseFirstTask.resolve();
    await firstTask;

    await expect(pendingUpdate).rejects.toBeInstanceOf(
      ProjectRoleRequiredError,
    );
  });

  it("rejects missing or non-text documents after queue wait", async () => {
    const sessionHandle = await createSessionHandle(
      createStoredDocumentTextState("Hello", 1),
    );
    const documentRepository = createDocumentRepository();
    const service = createRealtimeDocumentService({
      collaborationService: createCollaborationService(),
      projectAccessService: createProjectAccessService(),
      documentRepository,
      currentTextStateService: createCurrentTextStateService(),
    });

    documentRepository.findById.mockResolvedValue(
      createStoredDocument({ kind: "binary", mime: "image/png" }),
    );

    await expect(
      service.applyUpdate({
        projectId: "project-1",
        documentId: "document-1",
        userId: "user-1",
        sessionHandle,
        update: createIncrementalUpdate(
          createStoredDocumentTextState("Hello", 1).yjsState,
          (document) => {
            document.getText("content").insert(5, " world");
          },
        ),
        isCurrentSession: () => true,
      }),
    ).rejects.toBeInstanceOf(RealtimeDocumentNotFoundError);
  });

  it("propagates membership loss during update authorization", async () => {
    const service = createRealtimeDocumentService({
      collaborationService: createCollaborationService(),
      projectAccessService: createProjectAccessService({
        requireProjectRole: vi
          .fn()
          .mockRejectedValue(new ProjectNotFoundError()),
      }),
      documentRepository: createDocumentRepository(),
      currentTextStateService: createCurrentTextStateService(),
    });

    await expect(
      service.applyUpdate({
        projectId: "project-1",
        documentId: "document-1",
        userId: "user-1",
        sessionHandle: await createSessionHandle(
          createStoredDocumentTextState("Hello", 1),
        ),
        update: createIncrementalUpdate(
          createStoredDocumentTextState("Hello", 1).yjsState,
          (document) => {
            document.getText("content").insert(5, " world");
          },
        ),
        isCurrentSession: () => true,
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

function createProjectAccessService(
  overrides: Partial<Pick<ProjectAccessService, "requireProjectRole">> = {},
) {
  return {
    requireProjectRole: vi
      .fn<ProjectAccessService["requireProjectRole"]>()
      .mockResolvedValue({
        project: {
          id: "project-1",
          name: "Project",
          createdAt: new Date("2026-03-01T12:00:00.000Z"),
          updatedAt: new Date("2026-03-01T12:00:00.000Z"),
          tombstoneAt: null,
        },
        myRole: "admin",
      }),
    ...overrides,
  };
}

function createDocumentRepository(
  overrides: Partial<Pick<DocumentRepository, "findById">> = {},
) {
  return {
    findById: vi.fn<DocumentRepository["findById"]>(),
    ...overrides,
  };
}

function createCurrentTextStateService(
  overrides: Partial<
    Pick<CurrentTextStateService, "loadOrHydrate" | "persist">
  > = {},
) {
  return {
    loadOrHydrate: vi.fn<CurrentTextStateService["loadOrHydrate"]>(),
    persist: vi.fn<CurrentTextStateService["persist"]>(),
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
  text: string,
  version: number,
): StoredDocumentTextState {
  const collaborationDocument =
    createCollaborationService().createDocumentFromText(text);

  try {
    return {
      documentId: "document-1",
      yjsState: collaborationDocument.exportUpdate(),
      textContent: collaborationDocument.getText(),
      version,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    };
  } finally {
    collaborationDocument.destroy();
  }
}

function createStoredDocumentTextStateFromUpdate(
  yjsState: Uint8Array,
  version: number,
): StoredDocumentTextState {
  const collaborationDocument =
    createCollaborationService().createDocumentFromUpdate(yjsState);

  try {
    return {
      documentId: "document-1",
      yjsState,
      textContent: collaborationDocument.getText(),
      version,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    };
  } finally {
    collaborationDocument.destroy();
  }
}

async function createSessionHandle(
  state: StoredDocumentTextState,
): Promise<ActiveDocumentSessionHandle> {
  const registry = createActiveDocumentRegistry({
    collaborationService: createCollaborationService(),
    loadInitialDocumentState: async () => ({
      kind: "yjs-update",
      update: state.yjsState,
      serverVersion: state.version,
    }),
    persistOnIdle: async () => {},
  });

  return registry.join({
    projectId: "project-1",
    documentId: state.documentId,
  });
}

function createIncrementalUpdate(
  baseState: Uint8Array,
  mutate: (document: Y.Doc) => void,
) {
  const baseDocument = new Y.Doc();
  const nextDocument = new Y.Doc();

  try {
    Y.applyUpdate(baseDocument, baseState);
    Y.applyUpdate(nextDocument, baseState);
    mutate(nextDocument);

    return Y.encodeStateAsUpdate(
      nextDocument,
      Y.encodeStateVector(baseDocument),
    );
  } finally {
    baseDocument.destroy();
    nextDocument.destroy();
  }
}

function applyMutationToState(
  baseState: Uint8Array,
  mutate: (document: Y.Doc) => void,
) {
  const document = new Y.Doc();

  try {
    Y.applyUpdate(document, baseState);
    mutate(document);

    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

function applyUpdateToState(baseState: Uint8Array, update: Uint8Array): string {
  const document = new Y.Doc();

  try {
    Y.applyUpdate(document, baseState);
    Y.applyUpdate(document, update);

    return document.getText("content").toString();
  } finally {
    document.destroy();
  }
}

function applyIncrementalUpdate(
  baseState: Uint8Array,
  update: Uint8Array,
): Uint8Array {
  const document = new Y.Doc();

  try {
    Y.applyUpdate(document, baseState);
    Y.applyUpdate(document, update);

    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}
