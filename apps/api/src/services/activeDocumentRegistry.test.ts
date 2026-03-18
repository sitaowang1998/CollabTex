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
      .mockResolvedValue(createEmptyState());
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

  it("exposes a read-only live session view", async () => {
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const firstHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(firstHandle.session.clientCount).toBe(2);
    expect(() => {
      (firstHandle.session as { clientCount: number }).clientCount = 99;
    }).toThrow();
    expect(firstHandle.session.clientCount).toBe(2);

    await secondHandle.leave();

    expect(firstHandle.session.clientCount).toBe(1);

    await firstHandle.leave();
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

    initialState.resolve(createEmptyState());

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
        serverVersion: 3,
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
    expect(handle.session.serverVersion).toBe(3);

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
      .mockResolvedValue(createEmptyState());
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

  it("invalidates an active session so future joins reload durable state", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const loadInitialDocumentState = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
        }) => Promise<InitialDocumentState>
      >()
      .mockResolvedValue(createEmptyState());
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

    registry.invalidate({
      projectId: "project-1",
      documentId: "doc-1",
    });

    const secondHandle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    expect(loadInitialDocumentState).toHaveBeenCalledTimes(2);
    expect(secondHandle.session).not.toBe(firstHandle.session);

    await firstHandle.leave();

    expect(persistOnIdle).not.toHaveBeenCalled();
    expect(firstHandle.session.document.destroy).toHaveBeenCalledTimes(1);

    await secondHandle.leave();

    expect(persistOnIdle).toHaveBeenCalledTimes(1);
  });

  it("retries joins against a fresh generation when invalidation races with initial loading", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const firstState = createDeferred<InitialDocumentState>();
    const secondState = createDeferred<InitialDocumentState>();
    const loadInitialDocumentState = vi
      .fn<
        (input: {
          projectId: string;
          documentId: string;
        }) => Promise<InitialDocumentState>
      >()
      .mockReturnValueOnce(firstState.promise)
      .mockReturnValueOnce(secondState.promise);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState,
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const firstJoin = registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    registry.invalidate({
      projectId: "project-1",
      documentId: "doc-1",
    });

    const secondJoin = registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    firstState.resolve(createYjsState(Uint8Array.from([1, 2, 3]), 1));
    secondState.resolve(createYjsState(Uint8Array.from([4, 5, 6]), 9));

    const [firstHandle, secondHandle] = await Promise.all([
      firstJoin,
      secondJoin,
    ]);

    expect(loadInitialDocumentState).toHaveBeenCalledTimes(2);
    expect(firstHandle.session).toBe(secondHandle.session);
    expect(firstHandle.session.serverVersion).toBe(9);

    await firstHandle.leave();
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
            ? createEmptyState()
            : createYjsState(Uint8Array.from([1, 2, 3, 4]), 2),
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
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
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
      .mockResolvedValueOnce(createEmptyState());
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
          serverVersion: number;
        }) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
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
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
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
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
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

  it("does not reject leave when idle persistence fails after the session becomes active again", async () => {
    const collaborationService = createCollaborationServiceDouble();
    const firstPersist = createDeferred<void>();
    const persistOnIdle = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstPersist.promise)
      .mockResolvedValueOnce(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
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

    firstPersist.reject(new Error("write failed"));

    await expect(firstLeavePromise).resolves.toBeUndefined();
    expect(secondHandle.session).toBe(firstHandle.session);
    expect(secondHandle.session.clientCount).toBe(1);

    await secondHandle.leave();

    expect(persistOnIdle).toHaveBeenCalledTimes(2);
    expect(firstHandle.session.document.destroy).toHaveBeenCalledTimes(1);
  });

  it("serializes exclusive tasks per session", async () => {
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const executionOrder: string[] = [];
    const releaseFirstTask = createDeferred<void>();

    const firstTask = handle.runExclusive(async (session) => {
      executionOrder.push(`first:start:${session.serverVersion}`);
      session.serverVersion = 1;
      await releaseFirstTask.promise;
      executionOrder.push(`first:end:${session.serverVersion}`);
    });
    const secondTask = handle.runExclusive(async (session) => {
      executionOrder.push(`second:${session.serverVersion}`);
      session.serverVersion = 2;
    });

    await vi.waitFor(() => {
      expect(executionOrder).toEqual(["first:start:0"]);
    });

    releaseFirstTask.resolve();
    await firstTask;
    await secondTask;

    expect(executionOrder).toEqual([
      "first:start:0",
      "first:end:1",
      "second:1",
    ]);
    expect(handle.session.serverVersion).toBe(2);

    await handle.leave();
  });

  it("drain waits for in-flight exclusive tasks to complete", async () => {
    const releaseTask = createDeferred<void>();
    const persistOnIdle = vi.fn().mockResolvedValue(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle,
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    const taskCompleted = { value: false };
    handle.runExclusive(async () => {
      await releaseTask.promise;
      taskCompleted.value = true;
    });

    const drainPromise = registry.drain(5000);

    await vi.waitFor(() => {
      expect(taskCompleted.value).toBe(false);
    });

    releaseTask.resolve();
    await drainPromise;

    expect(taskCompleted.value).toBe(true);

    await handle.leave();
  });

  it("drain respects its timeout", async () => {
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    // Queue a task that never resolves
    handle.runExclusive(() => new Promise<void>(() => {}));

    const start = Date.now();
    await registry.drain(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);

    // Clean up — invalidate to discard the stuck session
    registry.invalidate({ projectId: "project-1", documentId: "doc-1" });
  });

  it("drain resolves immediately when no sessions are active", async () => {
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    await registry.drain(5000);
  });

  it("primary durability does not depend on idle flush timing", async () => {
    const persistOnIdle = vi.fn().mockResolvedValue(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle,
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    await handle.runExclusive(async (session) => {
      session.serverVersion = 1;
    });

    // persistOnIdle should NOT have been called while the session is active
    expect(persistOnIdle).not.toHaveBeenCalled();

    await handle.leave();

    // persistOnIdle is called only after the last client leaves
    expect(persistOnIdle).toHaveBeenCalledTimes(1);
  });

  it("drain waits for pending session initialization", async () => {
    const initialState = createDeferred<InitialDocumentState>();
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockReturnValue(initialState.promise),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const joinPromise = registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    let drained = false;
    const drainPromise = registry.drain(5000).then(() => {
      drained = true;
    });

    await vi.waitFor(() => {
      expect(drained).toBe(false);
    });

    initialState.resolve(createEmptyState());
    await drainPromise;

    expect(drained).toBe(true);

    const handle = await joinPromise;
    await handle.leave();
  });

  it("drain resolves when a pending session init fails", async () => {
    const initialState = createDeferred<InitialDocumentState>();
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockReturnValue(initialState.promise),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });

    const joinPromise = registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    const drainPromise = registry.drain(5000);

    initialState.reject(new Error("snapshot unavailable"));

    await expect(drainPromise).resolves.toBeUndefined();
    await expect(joinPromise).rejects.toThrow("snapshot unavailable");
  });

  it("drain logs when mutations fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    handle
      .runExclusive(async () => {
        throw new Error("mutation failed");
      })
      .catch(() => {});

    await registry.drain(5000);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("in-flight mutations failed"),
    );

    errorSpy.mockRestore();
    registry.invalidate({ projectId: "project-1", documentId: "doc-1" });
  });

  it("drain logs when timeout fires", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle: vi.fn().mockResolvedValue(undefined),
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });

    handle.runExclusive(() => new Promise<void>(() => {}));

    await registry.drain(50);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("timed out after 50ms"),
    );

    warnSpy.mockRestore();
    registry.invalidate({ projectId: "project-1", documentId: "doc-1" });
  });

  it("waits for queued mutations before idle persistence", async () => {
    const persistOnIdle = vi.fn().mockResolvedValue(undefined);
    const registry = createActiveDocumentRegistry({
      collaborationService: createCollaborationServiceDouble(),
      loadInitialDocumentState: vi.fn().mockResolvedValue(createEmptyState()),
      persistOnIdle,
    });
    const handle = await registry.join({
      projectId: "project-1",
      documentId: "doc-1",
    });
    const releaseTask = createDeferred<void>();

    const runningTask = handle.runExclusive(async () => {
      await releaseTask.promise;
    });
    const leavePromise = handle.leave();

    await vi.waitFor(() => {
      expect(persistOnIdle).not.toHaveBeenCalled();
    });

    releaseTask.resolve();
    await runningTask;
    await leavePromise;

    expect(persistOnIdle).toHaveBeenCalledTimes(1);
  });
});

function createEmptyState(): InitialDocumentState {
  return {
    kind: "empty",
    serverVersion: 0,
  };
}

function createYjsState(
  update: Uint8Array,
  serverVersion: number,
): InitialDocumentState {
  return {
    kind: "yjs-update",
    update,
    serverVersion,
  };
}

function createCollaborationServiceDouble(): CollaborationService {
  return {
    createDocumentFromUpdate: vi
      .fn<CollaborationService["createDocumentFromUpdate"]>()
      .mockImplementation(() => createDocumentDouble()),
    createEmptyTextDocument: vi
      .fn<CollaborationService["createEmptyTextDocument"]>()
      .mockImplementation(() => createDocumentDouble()),
    createDocumentFromText: vi
      .fn<CollaborationService["createDocumentFromText"]>()
      .mockImplementation(() => createDocumentDouble()),
    diffUpdates: vi
      .fn<CollaborationService["diffUpdates"]>()
      .mockReturnValue(Uint8Array.from([])),
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
