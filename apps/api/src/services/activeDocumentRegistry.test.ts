import { describe, expect, it, vi } from "vitest";
import type {
  CollaborationDocument,
  CollaborationService,
} from "./collaboration.js";
import { createDeferred } from "../test/helpers/deferred.js";
import {
  createActiveDocumentRegistry,
  type InitialDocumentState,
} from "./activeDocumentRegistry.js";

describe("active document registry", () => {
  it("creates and reuses one session per active document", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const loadInitialDocumentState = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
        }) => Promise<InitialDocumentState>
      >()
      .mockResolvedValue({
        kind: "empty",
      });
    const persistOnIdle = vi.fn().mockResolvedValue(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState,
      persistOnIdle,
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(loadInitialDocumentState).toHaveBeenCalledTimes(1);
    expect(collaborationService.createEmptyTextDocument).toHaveBeenCalledTimes(
      1,
    );
    expect(firstHandle.session).toBe(secondHandle.session);
    expect(firstHandle.session.clientCount).toBe(2);

    await firstHandle.leave();

    expect(firstHandle.session.clientCount).toBe(1);
    expect(persistOnIdle).not.toHaveBeenCalled();

    await secondHandle.leave();

    expect(persistOnIdle).toHaveBeenCalledTimes(1);
    expect(firstHandle.session.document.destroy).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent joins while the initial state is still loading", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const initialState = createDeferred<InitialDocumentState>();
    const loadInitialDocumentState = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
        }) => Promise<InitialDocumentState>
      >()
      .mockReturnValue(initialState.promise);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState,
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const firstJoin = registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const secondJoin = registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(loadInitialDocumentState).toHaveBeenCalledTimes(1);
    expect(collaborationService.createEmptyTextDocument).not.toHaveBeenCalled();

    initialState.resolve({
      kind: "empty",
    });

    const [firstHandle, secondHandle] = await Promise.all([
      firstJoin,
      secondJoin,
    ]);

    expect(collaborationService.createEmptyTextDocument).toHaveBeenCalledTimes(
      1,
    );
    expect(firstHandle.session).toBe(secondHandle.session);
    expect(firstHandle.session.clientCount).toBe(2);

    await firstHandle.leave();
    await secondHandle.leave();
  });

  it("hydrates from a persisted yjs update when present", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const update = Uint8Array.from([1, 2, 3, 4]);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue({
        kind: "yjs-update",
        update,
      }),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(collaborationService.createDocumentFromUpdate).toHaveBeenCalledWith(
      update,
    );
    expect(collaborationService.createEmptyTextDocument).not.toHaveBeenCalled();

    await handle.leave();
  });

  it("creates a fresh session after the last client leaves", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const loadInitialDocumentState = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
        }) => Promise<InitialDocumentState>
      >()
      .mockResolvedValue({
        kind: "empty",
      });
    const persistOnIdle = vi.fn().mockResolvedValue(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState,
      persistOnIdle,
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    await firstHandle.leave();

    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(loadInitialDocumentState).toHaveBeenCalledTimes(2);
    expect(secondHandle.session).not.toBe(firstHandle.session);
    expect(secondHandle.session.clientCount).toBe(1);

    await secondHandle.leave();
  });

  it("keeps different documents isolated", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi
        .fn<
          (input: {
            projectId: string;
            documentId: string;
          }) => Promise<InitialDocumentState>
        >()
        .mockImplementation(async ({ documentId }) =>
          documentId === "doc-1"
            ? { kind: "empty" }
            : { kind: "yjs-update", update: Uint8Array.from([1, 2, 3, 4]) },
        ),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-2",
    });
    const thirdHandle = await registry.join({
      projectId: "project-2",
      documentId: "doc-1",
    });

    expect(firstHandle.session).not.toBe(secondHandle.session);
    expect(firstHandle.session).not.toBe(thirdHandle.session);
    expect(secondHandle.session).not.toBe(thirdHandle.session);

    await firstHandle.leave();
    await secondHandle.leave();
    await thirdHandle.leave();
  });

  it("makes leave idempotent per handle", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const persistOnIdle = vi.fn().mockResolvedValue(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue({
        kind: "empty",
      }),
      persistOnIdle,
    });

    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    await handle.leave();
    await handle.leave();

    expect(persistOnIdle).toHaveBeenCalledTimes(1);
    expect(handle.session.document.destroy).toHaveBeenCalledTimes(1);
    expect(handle.session.clientCount).toBe(0);
  });

  it("does not cache a session when initial loading fails", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const loadInitialDocumentState = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
        }) => Promise<InitialDocumentState>
      >()
      .mockRejectedValueOnce(new Error("snapshot unavailable"))
      .mockResolvedValueOnce({
        kind: "empty",
      });
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState,
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      registry.join({
        projectId: "project-1",
        documentId: "doc-1",
      }),
    ).rejects.toThrow("snapshot unavailable");

    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(loadInitialDocumentState).toHaveBeenCalledTimes(2);

    await handle.leave();
  });

  it("removes and destroys a session even when idle persistence fails", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const persistOnIdle = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
          document: CollaborationDocument;
        }) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue({
        kind: "empty",
      }),
      persistOnIdle,
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    await expect(firstHandle.leave()).rejects.toThrow("write failed");
    expect(firstHandle.session.document.destroy).toHaveBeenCalledTimes(1);

    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(secondHandle.session).not.toBe(firstHandle.session);

    await secondHandle.leave();
  });

  it("reuses the same session while idle persistence is still running", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const persistOnIdle = createDeferred<void>();
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue({
        kind: "empty",
      }),
      persistOnIdle: vi.fn().mockReturnValue(persistOnIdle.promise),
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    const leavePromise = firstHandle.leave();
    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(secondHandle.session).toBe(firstHandle.session);
    expect(firstHandle.session.document.destroy).not.toHaveBeenCalled();

    persistOnIdle.resolve();

    await leavePromise;

    expect(firstHandle.session.document.destroy).not.toHaveBeenCalled();

    await secondHandle.leave();
  });

  it("runs another idle persistence cycle when a session rejoins during close and becomes idle again", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const firstPersist = createDeferred<void>();
    const secondPersist = createDeferred<void>();
    const persistOnIdle = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstPersist.promise)
      .mockReturnValueOnce(secondPersist.promise);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue({
        kind: "empty",
      }),
      persistOnIdle,
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const firstLeavePromise = firstHandle.leave();
    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const secondLeavePromise = secondHandle.leave();

    firstPersist.resolve();
    await vi.waitFor(() => {
      expect(persistOnIdle).toHaveBeenCalledTimes(2);
    });

    expect(firstHandle.session.document.destroy).not.toHaveBeenCalled();

    secondPersist.resolve();
    await firstLeavePromise;
    await secondLeavePromise;

    expect(firstHandle.session.document.destroy).toHaveBeenCalledTimes(1);
  });
});

function createCollaborationServiceDouble(): CollaborationService {
  return {
    createDocumentFromUpdate: vi
      .fn<CollaborationService["createDocumentFromUpdate"]>()
      .mockImplementation(() => createDocumentDouble()),
    createEmptyTextDocument: vi
      .fn<CollaborationService["createEmptyTextDocument"]>()
      .mockImplementation(() => createDocumentDouble()),
  };
}

function createDocumentDouble(): CollaborationDocument {
  return {
    applyUpdate: vi.fn(),
    exportUpdate: vi.fn().mockReturnValue(Uint8Array.from([])),
    getText: vi.fn().mockReturnValue(""),
    destroy: vi.fn(),
  };
}
