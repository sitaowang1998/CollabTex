import * as Y from "yjs";
import { YjsDocumentSync, type YjsDocumentSyncOptions } from "./yjs-sync";
import type { TypedSocket } from "./socket";

type Handler = (...args: unknown[]) => void;

function createMockSocket(connected = true) {
  const handlers = new Map<string, Set<Handler>>();
  const ioHandlers = new Map<string, Set<Handler>>();

  const getOrCreate = (map: Map<string, Set<Handler>>, event: string) => {
    if (!map.has(event)) map.set(event, new Set());
    return map.get(event)!;
  };

  const socket = {
    connected,
    on: vi.fn((event: string, handler: Handler) => {
      getOrCreate(handlers, event).add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
    emit: vi.fn(),
    io: {
      on: vi.fn((event: string, handler: Handler) => {
        getOrCreate(ioHandlers, event).add(handler);
      }),
      off: vi.fn((event: string, handler: Handler) => {
        ioHandlers.get(event)?.delete(handler);
      }),
    },
    _fire(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((h) => h(...args));
    },
    _fireIo(event: string, ...args: unknown[]) {
      ioHandlers.get(event)?.forEach((h) => h(...args));
    },
    _handlerCount(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
  };

  return socket;
}

function createSyncOptions(
  socket: ReturnType<typeof createMockSocket>,
  overrides?: Partial<YjsDocumentSyncOptions>,
): YjsDocumentSyncOptions {
  return {
    projectId: "project-1",
    documentId: "doc-1",
    socket: socket as unknown as TypedSocket,
    onSynced: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function createYjsStateB64(text: string): string {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  let binary = "";
  for (const byte of state) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("YjsDocumentSync", () => {
  it("emits workspace:join immediately when socket is connected", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    expect(socket.emit).toHaveBeenCalledWith(
      "workspace:join",
      expect.objectContaining({
        projectId: "project-1",
        documentId: "doc-1",
      }),
    );

    sync.destroy();
  });

  it("waits for connect event when socket is not connected", () => {
    const socket = createMockSocket(false);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    expect(socket.on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(socket.emit).not.toHaveBeenCalledWith(
      "workspace:join",
      expect.anything(),
    );

    socket._fire("connect");

    expect(socket.emit).toHaveBeenCalledWith(
      "workspace:join",
      expect.objectContaining({
        projectId: "project-1",
        documentId: "doc-1",
      }),
    );

    sync.destroy();
  });

  it("applies sync response and calls onSynced", () => {
    const socket = createMockSocket(true);
    const onSynced = vi.fn();
    const sync = new YjsDocumentSync(createSyncOptions(socket, { onSynced }));

    const stateB64 = createYjsStateB64("hello world");
    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64,
      serverVersion: 5,
    });

    expect(onSynced).toHaveBeenCalled();
    expect(sync.isSynced).toBe(true);
    expect(sync.serverVersion).toBe(5);
    expect(sync.doc.getText("content").toString()).toBe("hello world");

    sync.destroy();
  });

  it("ignores sync response for different documentId", () => {
    const socket = createMockSocket(true);
    const onSynced = vi.fn();
    const sync = new YjsDocumentSync(createSyncOptions(socket, { onSynced }));

    socket._fire("doc.sync.response", {
      documentId: "other-doc",
      stateB64: createYjsStateB64("wrong"),
      serverVersion: 1,
    });

    expect(onSynced).not.toHaveBeenCalled();
    expect(sync.isSynced).toBe(false);

    sync.destroy();
  });

  it("sends doc.update when local ydoc changes", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64: createYjsStateB64(""),
      serverVersion: 1,
    });

    socket.emit.mockClear();
    sync.doc.getText("content").insert(0, "typed text");

    expect(socket.emit).toHaveBeenCalledWith(
      "doc.update",
      expect.objectContaining({
        documentId: "doc-1",
        updateB64: expect.any(String),
        clientUpdateId: expect.any(String),
      }),
    );

    sync.destroy();
  });

  it("applies remote doc.update without re-emitting", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64: createYjsStateB64("initial"),
      serverVersion: 1,
    });

    socket.emit.mockClear();

    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(sync.doc));
    remoteDoc.getText("content").insert(7, " added");
    const update = Y.encodeStateAsUpdate(remoteDoc);
    let binary = "";
    for (const byte of update) binary += String.fromCharCode(byte);
    const updateB64 = btoa(binary);
    remoteDoc.destroy();

    socket._fire("doc.update", {
      documentId: "doc-1",
      updateB64,
      clientUpdateId: "remote-1",
      serverVersion: 2,
    });

    expect(sync.doc.getText("content").toString()).toContain("added");
    expect(sync.serverVersion).toBe(2);
    expect(socket.emit).not.toHaveBeenCalledWith(
      "doc.update",
      expect.anything(),
    );

    sync.destroy();
  });

  it("handles doc.reset by destroying doc and re-joining", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64: createYjsStateB64("before reset"),
      serverVersion: 1,
    });

    socket.emit.mockClear();

    socket._fire("doc.reset", {
      documentId: "doc-1",
      reason: "snapshot_restore",
      serverVersion: 2,
    });

    expect(sync.isSynced).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith(
      "workspace:join",
      expect.objectContaining({
        projectId: "project-1",
        documentId: "doc-1",
      }),
    );
    expect(sync.doc.getText("content").toString()).toBe("");

    sync.destroy();
  });

  it("calls onError for realtime:error events", () => {
    const socket = createMockSocket(true);
    const onError = vi.fn();
    const sync = new YjsDocumentSync(createSyncOptions(socket, { onError }));

    socket._fire("realtime:error", {
      code: "FORBIDDEN",
      message: "No access",
    });

    expect(onError).toHaveBeenCalledWith({
      code: "FORBIDDEN",
      message: "No access",
    });

    sync.destroy();
  });

  it("re-joins on socket reconnect", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));
    socket.emit.mockClear();

    socket._fireIo("reconnect");

    expect(socket.emit).toHaveBeenCalledWith(
      "workspace:join",
      expect.objectContaining({
        projectId: "project-1",
        documentId: "doc-1",
      }),
    );

    sync.destroy();
  });

  it("retries join after timeout if no sync response", () => {
    vi.useFakeTimers();
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    expect(socket.emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(socket.emit).toHaveBeenCalledTimes(2);

    sync.destroy();
    vi.useRealTimers();
  });

  it("clears join timeout when sync response arrives", () => {
    vi.useFakeTimers();
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64: createYjsStateB64(""),
      serverVersion: 1,
    });

    socket.emit.mockClear();

    vi.advanceTimersByTime(5000);
    expect(socket.emit).not.toHaveBeenCalledWith(
      "workspace:join",
      expect.anything(),
    );

    sync.destroy();
    vi.useRealTimers();
  });

  it("removes all listeners on destroy", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    expect(socket._handlerCount("doc.sync.response")).toBe(1);
    expect(socket._handlerCount("doc.update")).toBe(1);
    expect(socket._handlerCount("presence.update")).toBe(1);

    sync.destroy();

    expect(socket._handlerCount("doc.sync.response")).toBe(0);
    expect(socket._handlerCount("doc.update")).toBe(0);
    expect(socket._handlerCount("doc.reset")).toBe(0);
    expect(socket._handlerCount("realtime:error")).toBe(0);
    expect(socket._handlerCount("presence.update")).toBe(0);
  });

  it("exposes awareness instance with user info", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(
      createSyncOptions(socket, { userName: "Alice" }),
    );

    expect(sync.awareness).toBeDefined();
    expect(sync.awareness.doc).toBe(sync.doc);
    const localState = sync.awareness.getLocalState();
    expect(localState?.user?.name).toBe("Alice");
    expect(localState?.user?.color).toBeDefined();

    sync.destroy();
  });

  it("sets Anonymous as default user name", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    const localState = sync.awareness.getLocalState();
    expect(localState?.user?.name).toBe("Anonymous");

    sync.destroy();
  });

  it("broadcasts awareness removal on destroy when synced", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    // Sync first so _synced is true
    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64: createYjsStateB64(""),
      serverVersion: 1,
    });

    socket.emit.mockClear();

    sync.destroy();

    // Should have emitted presence.update with the removal
    expect(socket.emit).toHaveBeenCalledWith(
      "presence.update",
      expect.objectContaining({
        documentId: "doc-1",
        awarenessB64: expect.any(String),
      }),
    );
  });

  it("does not broadcast awareness removal when not synced", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket.emit.mockClear();

    // Destroy without syncing
    sync.destroy();

    expect(socket.emit).not.toHaveBeenCalledWith(
      "presence.update",
      expect.anything(),
    );
  });

  it("drops doc.update events that arrive before sync response", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    // Send a doc.update BEFORE sync response — should be ignored
    const remoteDoc = new Y.Doc();
    remoteDoc.getText("content").insert(0, "premature");
    const update = Y.encodeStateAsUpdate(remoteDoc);
    let binary = "";
    for (const byte of update) binary += String.fromCharCode(byte);
    remoteDoc.destroy();

    socket._fire("doc.update", {
      documentId: "doc-1",
      updateB64: btoa(binary),
      clientUpdateId: "early-1",
      serverVersion: 2,
    });

    // Content should still be empty (update was dropped)
    expect(sync.doc.getText("content").toString()).toBe("");

    sync.destroy();
  });

  it("does not emit local edits before sync completes", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket.emit.mockClear();

    // Type before sync response arrives
    sync.doc.getText("content").insert(0, "early typing");

    // Should NOT emit doc.update (not synced yet)
    expect(socket.emit).not.toHaveBeenCalledWith(
      "doc.update",
      expect.anything(),
    );

    sync.destroy();
  });

  it("does not throw when destroy is called twice", () => {
    const socket = createMockSocket(true);
    const sync = new YjsDocumentSync(createSyncOptions(socket));

    socket._fire("doc.sync.response", {
      documentId: "doc-1",
      stateB64: createYjsStateB64(""),
      serverVersion: 1,
    });

    // First destroy
    sync.destroy();

    // Second destroy should not throw
    expect(() => sync.destroy()).not.toThrow();
  });

  it("calls onError after max join retries", () => {
    vi.useFakeTimers();
    const socket = createMockSocket(true);
    const onError = vi.fn();
    const sync = new YjsDocumentSync(createSyncOptions(socket, { onError }));

    // Exhaust all retries (initial + 4 timeouts = 5 total)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(5000);
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "JOIN_TIMEOUT" }),
    );

    sync.destroy();
    vi.useRealTimers();
  });
});
