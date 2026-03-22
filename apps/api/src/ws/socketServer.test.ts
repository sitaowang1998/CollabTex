import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type {
  DocumentSyncResponseEvent,
  PresenceUpdateEvent,
  WorkspaceErrorEvent,
  WorkspaceOpenedEvent,
} from "@collab-tex/shared";
import {
  ActiveDocumentSessionInvalidatedError,
  createActiveDocumentRegistry,
} from "../services/activeDocumentRegistry.js";
import { signToken } from "../services/auth.js";
import { createCollaborationService } from "../services/collaboration.js";
import { ProjectNotFoundError } from "../services/projectAccess.js";
import { RealtimeDocumentSessionMismatchError } from "../services/realtimeDocument.js";
import type {
  WorkspaceOpenResult,
  WorkspaceService,
} from "../services/workspace.js";
import { testConfig } from "../test/helpers/appFactory.js";
import { createDeferred } from "../test/helpers/deferred.js";
import {
  createTestSocketServer,
  type TestSocketServer,
} from "../test/helpers/socket.js";
import {
  createTextWorkspaceRoomName,
  createWorkspaceRoomName,
  openWorkspace,
} from "./socketServer.js";

describe("socket server", () => {
  let socketServer: TestSocketServer | undefined;

  afterEach(async () => {
    if (socketServer) {
      await socketServer.close();
      socketServer = undefined;
    }
  });

  it("emits metadata-only workspace:opened and automatic sync for text joins", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const { opened, sync } = await new Promise<{
      opened: WorkspaceOpenedEvent;
      sync: DocumentSyncResponseEvent;
    }>((resolve, reject) => {
      let opened: WorkspaceOpenedEvent | null = null;
      let sync: DocumentSyncResponseEvent | null = null;

      const resolveIfReady = () => {
        if (!opened || !sync) {
          return;
        }

        client.close();
        resolve({ opened, sync });
      };

      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      client.once("workspace:opened", (payload) => {
        opened = payload;
        resolveIfReady();
      });

      client.once("doc.sync.response", (payload) => {
        sync = payload;
        resolveIfReady();
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(opened).toEqual({
      projectId: "project-123",
      document: {
        id: "doc-456",
        path: "/main.tex",
        kind: "text",
        mime: "text/x-tex",
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
      content: null,
    });
    expect(sync).toEqual({
      documentId: "doc-456",
      stateB64: sync.stateB64,
      serverVersion: 1,
    });
    expect(decodeStateB64(sync.stateB64)).toBe("\\section{Test}");
  });

  it("opens binary documents with null content and no automatic sync", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);
    const syncHandler = vi.fn();

    const opened = await new Promise<WorkspaceOpenedEvent>(
      (resolve, reject) => {
        client.on("doc.sync.response", syncHandler);

        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-binary",
          });
        });

        client.once("workspace:opened", async (payload) => {
          await waitForSocketFlush();
          client.close();
          resolve(payload);
        });

        client.once("realtime:error", (payload) => {
          client.close();
          reject(new Error(`Unexpected realtime error: ${payload.code}`));
        });

        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(opened).toEqual({
      projectId: "project-123",
      document: {
        id: "doc-binary",
        path: "/figure.png",
        kind: "binary",
        mime: "image/png",
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
      content: null,
    });
    expect(syncHandler).not.toHaveBeenCalled();
  });

  it("emits realtime:error when the user is not a project member", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("bob", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<{ code: string; message: string }>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });

        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "FORBIDDEN",
      message: "project membership required",
    });
  });

  it("rejects connections without a token", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect();

    const message = await new Promise<string>((resolve, reject) => {
      client.once("connect", () => {
        client.close();
        reject(new Error("Expected socket connection to be rejected"));
      });

      client.once("connect_error", (error) => {
        client.close();
        resolve(error.message);
      });
    });

    expect(message).toBe("missing token");
  });

  it("rejects connections with an invalid token", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect("not-a-valid-token");

    const message = await new Promise<string>((resolve, reject) => {
      client.once("connect", () => {
        client.close();
        reject(new Error("Expected socket connection to be rejected"));
      });

      client.once("connect_error", (error) => {
        client.close();
        resolve(error.message);
      });
    });

    expect(message).toBe("invalid token");
  });

  it("emits realtime:error for an invalid workspace join payload", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<{
      code: string;
      message: string;
    }>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "",
          documentId: "doc-456",
        });
      });

      client.once("realtime:error", (payload) => {
        client.close();
        resolve(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "projectId is required",
    });
  });

  it("emits realtime:error when the document is missing", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<{ code: string; message: string }>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "missing-doc",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });

        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "NOT_FOUND",
      message: "workspace document not found",
    });
  });

  it("broadcasts doc.reset to joined workspace clients", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const resetPayload = await new Promise<{
      documentId: string;
      reason: string;
      serverVersion: number;
    }>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      client.once("workspace:opened", async () => {
        await socketServer?.emitDocumentReset({
          projectId: "project-123",
          documentId: "doc-456",
          reason: "snapshot_restore",
          serverVersion: 7,
        });
      });

      client.once("doc.reset", (payload) => {
        client.close();
        resolve(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(resetPayload).toEqual({
      documentId: "doc-456",
      reason: "snapshot_restore",
      serverVersion: 7,
    });
  });

  it("reloads restored text state for rejoins after snapshot_restore", async () => {
    const collaborationService = createCollaborationService();
    let currentText = "\\section{Before}";
    let currentVersion = 1;
    const activeDocumentRegistry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: async () => ({
        kind: "yjs-update",
        update: createStateBytes(currentText),
        serverVersion: currentVersion,
      }),
      persistOnIdle: async () => {},
    });

    socketServer = await createTestSocketServer({
      workspaceService: {
        openDocument: async ({ documentId }) => ({
          workspace: createWorkspaceOpenedEvent(documentId),
          initialSync: {
            documentId,
            yjsState: createStateBytes(currentText),
            serverVersion: currentVersion,
          },
        }),
      },
      activeDocumentRegistry,
    });

    const firstClient = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const secondClient = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    try {
      const firstSync = await joinAndWaitForSync(firstClient, "doc-456");

      expect(firstSync.serverVersion).toBe(1);
      expect(decodeStateB64(firstSync.stateB64)).toBe("\\section{Before}");

      const resetPromise = waitForEvent<{
        documentId: string;
        reason: string;
        serverVersion: number;
      }>(firstClient, "doc.reset");

      currentText = "\\section{Restored}";
      currentVersion = 9;

      await socketServer.emitDocumentReset({
        projectId: "project-123",
        documentId: "doc-456",
        reason: "snapshot_restore",
        serverVersion: currentVersion,
      });
      const resetEvent = await resetPromise;

      expect(resetEvent).toEqual({
        documentId: "doc-456",
        reason: "snapshot_restore",
        serverVersion: currentVersion,
      });

      const secondSync = await joinAndWaitForSync(secondClient, "doc-456");

      expect(secondSync.serverVersion).toBe(currentVersion);
      expect(decodeStateB64(secondSync.stateB64)).toBe("\\section{Restored}");
    } finally {
      firstClient.close();
      secondClient.close();
    }
  });

  it("emits a generic unavailable error for unexpected workspace failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    socketServer = await createTestSocketServer({
      snapshotService: {
        loadDocumentContent: async () => {
          throw new Error("disk path leaked");
        },
        captureProjectSnapshot: async () => {
          throw new Error("Not implemented for socket tests");
        },
        listProjectSnapshots: async () => [],
        restoreProjectSnapshot: async () => {
          throw new Error("Not implemented for socket tests");
        },
      },
    });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    let errorPayload: { code: string; message: string };

    try {
      errorPayload = await new Promise<{ code: string; message: string }>(
        (resolve, reject) => {
          client.once("connect", () => {
            client.emit("workspace:join", {
              projectId: "project-123",
              documentId: "doc-456",
            });
          });

          client.once("realtime:error", (payload) => {
            client.close();
            resolve(payload);
          });

          client.once("connect_error", (error) => {
            client.close();
            reject(error);
          });
        },
      );

      expect(errorPayload).toEqual({
        code: "UNAVAILABLE",
        message: "workspace unavailable",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "Workspace open failed",
        {
          userId: "alice",
          projectId: "project-123",
          documentId: "doc-456",
        },
        expect.objectContaining({
          message: "disk path leaked",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("suppresses stale workspace:opened and sync events when a newer join finishes first", async () => {
    const firstJoin = createDeferred<WorkspaceOpenResult>();
    const secondJoin = createDeferred<WorkspaceOpenResult>();
    socketServer = await createTestSocketServer({
      workspaceService: createSequencedWorkspaceService({
        "doc-first": firstJoin.promise,
        "doc-second": secondJoin.promise,
      }),
      activeDocumentRegistry: createStaticActiveDocumentRegistry({
        "doc-first": {
          text: "\\section{doc-first}",
          serverVersion: 1,
        },
        "doc-second": {
          text: "\\section{doc-second}",
          serverVersion: 1,
        },
      }),
    });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);
    const openedEvents: WorkspaceOpenedEvent[] = [];
    const syncEvents: DocumentSyncResponseEvent[] = [];
    const errorEvents: WorkspaceErrorEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-first",
        });
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-second",
        });
        secondJoin.resolve(createWorkspaceOpenResult("doc-second"));
      });

      client.on("workspace:opened", async (payload) => {
        openedEvents.push(payload);

        if (payload.document.id !== "doc-second") {
          return;
        }

        firstJoin.resolve(createWorkspaceOpenResult("doc-first"));
        await waitForSocketFlush();
        client.close();
        resolve();
      });

      client.on("doc.sync.response", (payload) => {
        syncEvents.push(payload);
      });

      client.on("realtime:error", (payload) => {
        errorEvents.push(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(openedEvents).toEqual([createWorkspaceOpenedEvent("doc-second")]);
    expect(syncEvents).toHaveLength(1);
    expect(syncEvents[0]).toMatchObject({
      documentId: "doc-second",
      serverVersion: 1,
    });
    expect(decodeStateB64(syncEvents[0].stateB64)).toBe(
      "\\section{doc-second}",
    );
    expect(errorEvents).toEqual([]);
  });

  it("suppresses stale realtime:error events when a newer join succeeds", async () => {
    const firstJoin = createDeferred<WorkspaceOpenResult>();
    const secondJoin = createDeferred<WorkspaceOpenResult>();
    socketServer = await createTestSocketServer({
      workspaceService: createSequencedWorkspaceService({
        "doc-first": firstJoin.promise,
        "doc-second": secondJoin.promise,
      }),
    });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);
    const openedEvents: WorkspaceOpenedEvent[] = [];
    const errorEvents: WorkspaceErrorEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-first",
        });
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-second",
        });
        secondJoin.resolve(createWorkspaceOpenResult("doc-second"));
      });

      client.on("workspace:opened", async (payload) => {
        openedEvents.push(payload);

        if (payload.document.id !== "doc-second") {
          return;
        }

        firstJoin.reject(new Error("stale failure"));
        await waitForSocketFlush();
        client.close();
        resolve();
      });

      client.on("realtime:error", (payload) => {
        errorEvents.push(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(openedEvents).toEqual([createWorkspaceOpenedEvent("doc-second")]);
    expect(errorEvents).toEqual([]);
  });

  it("suppresses stale workspace events after an awaited room join loses to a newer join", async () => {
    const binaryRoomName = createWorkspaceRoomName("project-123", "doc-binary");
    const enteredBinaryJoin = createDeferred<void>();
    const releaseBinaryJoin = createDeferred<void>();
    const emittedEvents: Array<{ event: string; payload: unknown }> = [];
    const leaveCalls: string[] = [];
    let latestJoinSequence = 2;
    let activeWorkspaceRoomName = createTextWorkspaceRoomName(
      "project-123",
      "doc-first",
      0,
    );
    const firstHandle = await createStaticActiveDocumentRegistry({
      "doc-first": {
        text: "\\section{doc-first}",
        serverVersion: 1,
      },
    }).join({
      projectId: "project-123",
      documentId: "doc-first",
    });
    let activeTextSession = {
      projectId: "project-123",
      documentId: "doc-first",
      joinSequence: 1,
      workspaceRoomName: activeWorkspaceRoomName,
      handle: firstHandle,
    };
    const socket = {
      id: "socket-1",
      data: { userId: "alice" },
      leave: vi.fn(async (roomName: string) => {
        leaveCalls.push(roomName);
      }),
      join: vi.fn(async (roomName: string) => {
        if (roomName === binaryRoomName) {
          enteredBinaryJoin.resolve();
          await releaseBinaryJoin.promise;
        }
      }),
      emit: vi.fn((event: string, payload: unknown) => {
        emittedEvents.push({ event, payload });
      }),
    };
    const workspaceService = createSequencedWorkspaceService({
      "doc-binary": Promise.resolve({
        workspace: {
          ...createWorkspaceOpenedEvent("doc-binary"),
          document: {
            ...createWorkspaceOpenedEvent("doc-binary").document,
            kind: "binary",
            mime: "image/png",
            path: "/figure.png",
          },
        },
        initialSync: null,
      }),
      "doc-third": Promise.resolve(createWorkspaceOpenResult("doc-third")),
    });
    const activeDocumentRegistry = createStaticActiveDocumentRegistry({
      "doc-third": {
        text: "\\section{doc-third}",
        serverVersion: 1,
      },
    });
    let activeProjectRoomName: string | null = null;
    const sharedOpenInput = {
      activeDocumentRegistry,
      getActiveWorkspaceRoomName: () => activeWorkspaceRoomName,
      setActiveWorkspaceRoomName: (roomName: string) => {
        activeWorkspaceRoomName = roomName;
      },
      setActiveDocumentId: () => {},
      getActiveProjectRoomName: () => activeProjectRoomName,
      setActiveProjectRoomName: (roomName: string) => {
        activeProjectRoomName = roomName;
      },
      setActiveProjectId: () => {},
      getActiveTextSession: () => activeTextSession,
      swapActiveTextSession: (nextSession: typeof activeTextSession | null) => {
        const previousSession = activeTextSession;
        activeTextSession = nextSession;

        if (previousSession?.handle === nextSession?.handle) {
          return null;
        }

        return previousSession;
      },
      revalidateAccess: async () => {},
    };

    const staleJoin = openWorkspace(socket as never, workspaceService, {
      workspaceOpenInput: {
        userId: "alice",
        projectId: "project-123",
        documentId: "doc-binary",
      },
      joinSequence: 2,
      isLatestJoin: () => latestJoinSequence === 2,
      ...sharedOpenInput,
    });

    await enteredBinaryJoin.promise;

    latestJoinSequence = 3;

    await openWorkspace(socket as never, workspaceService, {
      workspaceOpenInput: {
        userId: "alice",
        projectId: "project-123",
        documentId: "doc-third",
      },
      joinSequence: 3,
      isLatestJoin: () => latestJoinSequence === 3,
      ...sharedOpenInput,
    });

    releaseBinaryJoin.resolve();
    await staleJoin;

    expect(
      emittedEvents.filter(({ event }) => event === "workspace:opened"),
    ).toEqual([
      {
        event: "workspace:opened",
        payload: createWorkspaceOpenedEvent("doc-third"),
      },
    ]);
    expect(
      emittedEvents.filter(({ event }) => event === "doc.sync.response"),
    ).toHaveLength(1);
    expect(
      emittedEvents.some(
        ({ event, payload }) =>
          event === "workspace:opened" &&
          (payload as WorkspaceOpenedEvent).document.id === "doc-binary",
      ),
    ).toBe(false);
    expect(leaveCalls).toContain(binaryRoomName);
  });

  it("emits the joined active-session snapshot instead of a stale workspace-open snapshot", async () => {
    const collaborationService = createCollaborationService();
    const authoritativeDocument = collaborationService.createDocumentFromText(
      "\\section{Authoritative}",
    );
    const staleDocument =
      collaborationService.createDocumentFromText("\\section{Stale}");
    socketServer = await createTestSocketServer({
      workspaceService: {
        openDocument: async () => ({
          workspace: createWorkspaceOpenedEvent("doc-456"),
          initialSync: {
            documentId: "doc-456",
            yjsState: staleDocument.exportUpdate(),
            serverVersion: 1,
          },
        }),
      },
      activeDocumentRegistry: {
        join: async () => {
          const session = {
            projectId: "project-123",
            documentId: "doc-456",
            generation: 0,
            clientCount: 1,
            document: authoritativeDocument,
            serverVersion: 7,
            isInvalidated: false,
          };

          return {
            session,
            runExclusive: async (task) => task(session),
            leave: async () => {},
          };
        },
        invalidate: () => ({ invalidatedGeneration: 0 }),
        drain: async () => ({ timedOut: false, failedCount: 0 }),
      },
    });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const sync = await new Promise<DocumentSyncResponseEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(sync.serverVersion).toBe(7);
    expect(decodeStateB64(sync.stateB64)).toBe("\\section{Authoritative}");

    staleDocument.destroy();
    authoritativeDocument.destroy();
  });

  it("retries workspace:join when the first joined session is invalidated before sync", async () => {
    const collaborationService = createCollaborationService();
    const staleDocument =
      collaborationService.createDocumentFromText("\\section{Stale}");
    const authoritativeDocument = collaborationService.createDocumentFromText(
      "\\section{Restored}",
    );
    const staleHandle = {
      session: {
        projectId: "project-123",
        documentId: "doc-456",
        generation: 0,
        clientCount: 1,
        document: staleDocument,
        serverVersion: 1,
        isInvalidated: false,
      },
      runExclusive: async () => {
        throw new ActiveDocumentSessionInvalidatedError();
      },
      leave: vi.fn().mockResolvedValue(undefined),
    };
    const authoritativeSession = {
      projectId: "project-123",
      documentId: "doc-456",
      generation: 1,
      clientCount: 1,
      document: authoritativeDocument,
      serverVersion: 9,
      isInvalidated: false,
    };
    const authoritativeHandle = {
      session: authoritativeSession,
      runExclusive: async <Result>(
        task: (session: typeof authoritativeSession) => Promise<Result>,
      ) => task(authoritativeSession),
      leave: vi.fn().mockResolvedValue(undefined),
    };
    const join = vi
      .fn()
      .mockResolvedValueOnce(staleHandle)
      .mockResolvedValueOnce(authoritativeHandle);

    socketServer = await createTestSocketServer({
      workspaceService: {
        openDocument: async () => ({
          workspace: createWorkspaceOpenedEvent("doc-456"),
          initialSync: {
            documentId: "doc-456",
            yjsState: staleDocument.exportUpdate(),
            serverVersion: 1,
          },
        }),
      },
      activeDocumentRegistry: {
        join,
        invalidate: () => ({ invalidatedGeneration: 0 }),
        drain: async () => ({ timedOut: false, failedCount: 0 }),
      },
    });
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const sync = await new Promise<DocumentSyncResponseEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });
        client.once("doc.sync.response", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("realtime:error", (payload) => {
          client.close();
          reject(new Error(`Unexpected realtime error: ${payload.code}`));
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(join).toHaveBeenCalledTimes(2);
    expect(staleHandle.leave).toHaveBeenCalledTimes(1);
    expect(sync.serverVersion).toBe(9);
    expect(decodeStateB64(sync.stateB64)).toBe("\\section{Restored}");

    staleDocument.destroy();
    authoritativeDocument.destroy();
  });

  it("delivers accepted updates to the sender and broadcasts them to other joined sockets", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const receiver = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      ack: {
        documentId: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      update: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      senderUpdate: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      senderStateB64: string;
    }>((resolve, reject) => {
      let senderReady = false;
      let receiverReady = false;
      let senderStateB64 = "";
      let ack: {
        documentId: string;
        clientUpdateId: string;
        serverVersion: number;
      } | null = null;
      let update: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      } | null = null;
      let senderUpdate: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      } | null = null;

      const resolveIfReady = () => {
        if (!ack || !update || !senderUpdate) {
          return;
        }

        sender.close();
        receiver.close();
        resolve({ ack, update, senderUpdate, senderStateB64 });
      };

      const maybeSendUpdate = () => {
        if (!senderReady || !receiverReady || !senderStateB64) {
          return;
        }

        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(senderStateB64, (document) => {
            document.getText("content").insert(14, " Revised");
          }),
          clientUpdateId: "client-update-1",
        });
      };

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      receiver.once("connect", () => {
        receiver.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.once("doc.sync.response", (payload) => {
        senderReady = true;
        senderStateB64 = payload.stateB64;
        maybeSendUpdate();
      });
      receiver.once("doc.sync.response", () => {
        receiverReady = true;
        maybeSendUpdate();
      });

      sender.once("doc.update", (payload) => {
        senderUpdate = payload;
        resolveIfReady();
      });
      sender.once("doc.update.ack", (payload) => {
        ack = payload;
        resolveIfReady();
      });
      receiver.once("doc.update", (payload) => {
        update = payload;
        resolveIfReady();
      });

      sender.once("realtime:error", (payload) => {
        sender.close();
        receiver.close();
        reject(new Error(`Unexpected sender realtime error: ${payload.code}`));
      });
      receiver.once("realtime:error", (payload) => {
        sender.close();
        receiver.close();
        reject(
          new Error(`Unexpected receiver realtime error: ${payload.code}`),
        );
      });
      sender.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
      receiver.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
    });

    expect(result.ack).toEqual({
      documentId: "doc-456",
      clientUpdateId: "client-update-1",
      serverVersion: 2,
    });
    expect(result.update).toEqual({
      documentId: "doc-456",
      updateB64: result.update.updateB64,
      clientUpdateId: "client-update-1",
      serverVersion: 2,
    });
    expect(result.senderUpdate).toEqual(result.update);
    expect(
      applyUpdateToStateB64(result.senderStateB64, result.update.updateB64),
    ).toBe("\\section{Test} Revised");
  });

  it("broadcasts the server-accepted update instead of the original client delta", async () => {
    let acceptedUpdateB64 = "";
    socketServer = await createTestSocketServer({
      realtimeDocumentService: {
        applyUpdate: async ({ buildAcceptedContext }) => ({
          serverVersion: 9,
          acceptedUpdate: Buffer.from(acceptedUpdateB64, "base64"),
          acceptedContext: buildAcceptedContext
            ? await buildAcceptedContext({
                session: { isInvalidated: false },
                isCurrentSession: true,
              })
            : undefined,
        }),
      },
    });
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const receiver = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    const broadcast = await new Promise<{
      ack: {
        documentId: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      update: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      senderUpdate: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      senderStateB64: string;
    }>((resolve, reject) => {
      let senderStateB64 = "";
      let senderReady = false;
      let receiverReady = false;
      let ack: {
        documentId: string;
        clientUpdateId: string;
        serverVersion: number;
      } | null = null;
      let update: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      } | null = null;
      let senderUpdate: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      } | null = null;

      const resolveIfReady = () => {
        if (!ack || !update || !senderUpdate) {
          return;
        }

        sender.close();
        receiver.close();
        resolve({ ack, update, senderUpdate, senderStateB64 });
      };

      const maybeSendUpdate = () => {
        if (!senderReady || !receiverReady) {
          return;
        }

        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(senderStateB64, (document) => {
            document.getText("content").insert(14, " Original");
          }),
          clientUpdateId: "client-update-1",
        });
      };

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      receiver.once("connect", () => {
        receiver.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.once("doc.sync.response", (payload) => {
        senderReady = true;
        senderStateB64 = payload.stateB64;
        acceptedUpdateB64 = createIncrementalUpdateB64(
          senderStateB64,
          (document) => {
            document.getText("content").insert(14, " Accepted");
          },
        );
        maybeSendUpdate();
      });
      receiver.once("doc.sync.response", () => {
        receiverReady = true;
        maybeSendUpdate();
      });

      sender.once("doc.update", (payload) => {
        senderUpdate = payload;
        resolveIfReady();
      });
      sender.once("doc.update.ack", (payload) => {
        ack = payload;
        resolveIfReady();
      });
      receiver.once("doc.update", (payload) => {
        update = payload;
        resolveIfReady();
      });

      sender.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
      receiver.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
    });

    expect(broadcast.ack).toEqual({
      documentId: "doc-456",
      clientUpdateId: "client-update-1",
      serverVersion: 9,
    });
    expect(broadcast.update).toEqual({
      documentId: "doc-456",
      updateB64: acceptedUpdateB64,
      clientUpdateId: "client-update-1",
      serverVersion: 9,
    });
    expect(broadcast.senderUpdate).toEqual(broadcast.update);
    expect(
      applyUpdateToStateB64(
        broadcast.senderStateB64,
        broadcast.update.updateB64,
      ),
    ).toBe("\\section{Test} Accepted");
  });

  it("suppresses sender update events after the socket switches documents while the write is pending", async () => {
    const updateStarted = createDeferred<void>();
    const releaseAcceptedUpdate = createDeferred<void>();
    socketServer = await createTestSocketServer({
      realtimeDocumentService: {
        applyUpdate: async ({
          update,
          isCurrentSession,
          buildAcceptedContext,
        }) => {
          updateStarted.resolve();
          await releaseAcceptedUpdate.promise;

          return {
            serverVersion: 2,
            acceptedUpdate: update,
            acceptedContext: buildAcceptedContext
              ? await buildAcceptedContext({
                  session: { isInvalidated: false },
                  isCurrentSession: isCurrentSession(),
                })
              : undefined,
          };
        },
      },
    });
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const receiver = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      receiverUpdate: {
        documentId: string;
        updateB64: string;
        clientUpdateId: string;
        serverVersion: number;
      };
      senderStateB64: string;
      senderUpdateCount: number;
      senderAckCount: number;
    }>((resolve, reject) => {
      let senderStateB64 = "";
      let senderReady = false;
      let receiverReady = false;
      let senderSwitched = false;
      let senderUpdateCount = 0;
      let senderAckCount = 0;

      const maybeSendUpdate = () => {
        if (!senderReady || !receiverReady || !senderStateB64) {
          return;
        }

        void (async () => {
          sender.emit("doc.update", {
            documentId: "doc-456",
            updateB64: createIncrementalUpdateB64(
              senderStateB64,
              (document) => {
                document.getText("content").insert(14, " Revised");
              },
            ),
            clientUpdateId: "client-update-1",
          });
          await updateStarted.promise;
          sender.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-second",
          });
        })();
      };

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      receiver.once("connect", () => {
        receiver.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.on("doc.sync.response", (payload) => {
        if (payload.documentId === "doc-456") {
          senderReady = true;
          senderStateB64 = payload.stateB64;
          maybeSendUpdate();
          return;
        }

        if (payload.documentId === "doc-second") {
          senderSwitched = true;
          releaseAcceptedUpdate.resolve();
        }
      });
      receiver.once("doc.sync.response", () => {
        receiverReady = true;
        maybeSendUpdate();
      });

      sender.on("doc.update", () => {
        senderUpdateCount += 1;
      });
      sender.on("doc.update.ack", () => {
        senderAckCount += 1;
      });
      receiver.once("doc.update", async (payload) => {
        if (!senderSwitched) {
          reject(new Error("Expected sender to switch before peer update"));
          return;
        }

        await waitForSocketFlush();
        sender.close();
        receiver.close();
        resolve({
          receiverUpdate: payload,
          senderStateB64,
          senderUpdateCount,
          senderAckCount,
        });
      });

      sender.once("realtime:error", (payload) => {
        sender.close();
        receiver.close();
        reject(new Error(`Unexpected sender realtime error: ${payload.code}`));
      });
      receiver.once("realtime:error", (payload) => {
        sender.close();
        receiver.close();
        reject(
          new Error(`Unexpected receiver realtime error: ${payload.code}`),
        );
      });
      sender.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
      receiver.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
    });

    expect(result.senderUpdateCount).toBe(0);
    expect(result.senderAckCount).toBe(0);
    expect(
      applyUpdateToStateB64(
        result.senderStateB64,
        result.receiverUpdate.updateB64,
      ),
    ).toBe("\\section{Test} Revised");
  });

  it("suppresses stale realtime:error when a queued doc.update loses authority after a document switch", async () => {
    const updateStarted = createDeferred<void>();
    const releaseFailure = createDeferred<void>();
    socketServer = await createTestSocketServer({
      realtimeDocumentService: {
        applyUpdate: async () => {
          updateStarted.resolve();
          await releaseFailure.promise;
          throw new RealtimeDocumentSessionMismatchError();
        },
      },
    });
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      errorCount: number;
      switchedDocumentId: string;
    }>((resolve, reject) => {
      let senderStateB64 = "";
      let errorCount = 0;

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.on("doc.sync.response", async (payload) => {
        if (payload.documentId === "doc-456") {
          senderStateB64 = payload.stateB64;
          sender.emit("doc.update", {
            documentId: "doc-456",
            updateB64: createIncrementalUpdateB64(
              senderStateB64,
              (document) => {
                document.getText("content").insert(14, " Revised");
              },
            ),
            clientUpdateId: "client-update-1",
          });
          await updateStarted.promise;
          sender.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-second",
          });
          return;
        }

        if (payload.documentId !== "doc-second") {
          return;
        }

        releaseFailure.resolve();
        await waitForSocketFlush();
        sender.close();
        resolve({
          errorCount,
          switchedDocumentId: payload.documentId,
        });
      });

      sender.on("realtime:error", () => {
        errorCount += 1;
      });
      sender.once("connect_error", (error) => {
        sender.close();
        reject(error);
      });
    });

    expect(result.switchedDocumentId).toBe("doc-second");
    expect(result.errorCount).toBe(0);
  });

  it("suppresses post-reset doc.update emits when snapshot_restore invalidates the session", async () => {
    const updateStarted = createDeferred<void>();
    const releaseAcceptedUpdate = createDeferred<void>();
    socketServer = await createTestSocketServer({
      realtimeDocumentService: {
        applyUpdate: async ({ update, buildAcceptedContext }) => {
          updateStarted.resolve();
          await releaseAcceptedUpdate.promise;

          return {
            serverVersion: 2,
            acceptedUpdate: update,
            acceptedContext: buildAcceptedContext
              ? await buildAcceptedContext({
                  session: { isInvalidated: true },
                  isCurrentSession: true,
                })
              : undefined,
          };
        },
      },
    });
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const receiver = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      senderUpdateCount: number;
      senderAckCount: number;
      receiverUpdateCount: number;
      senderResetVersion: number;
      receiverResetVersion: number;
    }>((resolve, reject) => {
      let senderStateB64 = "";
      let senderReady = false;
      let receiverReady = false;
      let senderUpdateCount = 0;
      let senderAckCount = 0;
      let receiverUpdateCount = 0;
      let senderResetVersion: number | null = null;
      let receiverResetVersion: number | null = null;

      const maybeSendUpdate = async () => {
        if (!senderReady || !receiverReady || !senderStateB64) {
          return;
        }

        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(senderStateB64, (document) => {
            document.getText("content").insert(14, " Revised");
          }),
          clientUpdateId: "client-update-1",
        });

        await updateStarted.promise;
        await socketServer?.emitDocumentReset({
          projectId: "project-123",
          documentId: "doc-456",
          reason: "snapshot_restore",
          serverVersion: 9,
        });
      };

      const resolveIfReady = async () => {
        if (senderResetVersion === null || receiverResetVersion === null) {
          return;
        }

        releaseAcceptedUpdate.resolve();
        await waitForSocketFlush();
        sender.close();
        receiver.close();
        resolve({
          senderUpdateCount,
          senderAckCount,
          receiverUpdateCount,
          senderResetVersion,
          receiverResetVersion,
        });
      };

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      receiver.once("connect", () => {
        receiver.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.once("doc.sync.response", async (payload) => {
        senderReady = true;
        senderStateB64 = payload.stateB64;
        await maybeSendUpdate();
      });
      receiver.once("doc.sync.response", async () => {
        receiverReady = true;
        await maybeSendUpdate();
      });

      sender.on("doc.update", () => {
        senderUpdateCount += 1;
      });
      sender.on("doc.update.ack", () => {
        senderAckCount += 1;
      });
      receiver.on("doc.update", () => {
        receiverUpdateCount += 1;
      });
      sender.once("doc.reset", async (payload) => {
        senderResetVersion = payload.serverVersion;
        await resolveIfReady();
      });
      receiver.once("doc.reset", async (payload) => {
        receiverResetVersion = payload.serverVersion;
        await resolveIfReady();
      });

      sender.once("realtime:error", (payload) => {
        sender.close();
        receiver.close();
        reject(new Error(`Unexpected sender realtime error: ${payload.code}`));
      });
      receiver.once("realtime:error", (payload) => {
        sender.close();
        receiver.close();
        reject(
          new Error(`Unexpected receiver realtime error: ${payload.code}`),
        );
      });
      sender.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
      receiver.once("connect_error", (error) => {
        sender.close();
        receiver.close();
        reject(error);
      });
    });

    expect(result.senderResetVersion).toBe(9);
    expect(result.receiverResetVersion).toBe(9);
    expect(result.senderUpdateCount).toBe(0);
    expect(result.senderAckCount).toBe(0);
    expect(result.receiverUpdateCount).toBe(0);
  });

  it("suppresses stale realtime:error when snapshot_restore invalidates a queued doc.update after the socket switches away", async () => {
    const updateStarted = createDeferred<void>();
    const releaseFailure = createDeferred<void>();
    socketServer = await createTestSocketServer({
      realtimeDocumentService: {
        applyUpdate: async () => {
          updateStarted.resolve();
          await releaseFailure.promise;
          throw new ActiveDocumentSessionInvalidatedError();
        },
      },
    });
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      errorCount: number;
      resetVersion: number;
      switchedDocumentId: string;
    }>((resolve, reject) => {
      let senderStateB64 = "";
      let errorCount = 0;

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.once("doc.sync.response", async (payload) => {
        senderStateB64 = payload.stateB64;
        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(senderStateB64, (document) => {
            document.getText("content").insert(14, " Revised");
          }),
          clientUpdateId: "client-update-1",
        });
        await updateStarted.promise;
        await socketServer?.emitDocumentReset({
          projectId: "project-123",
          documentId: "doc-456",
          reason: "snapshot_restore",
          serverVersion: 9,
        });
      });

      sender.once("doc.reset", async () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-second",
        });
      });

      sender.on("doc.sync.response", async (payload) => {
        if (payload.documentId !== "doc-second") {
          return;
        }

        releaseFailure.resolve();
        await waitForSocketFlush();
        sender.close();
        resolve({
          errorCount,
          resetVersion: 9,
          switchedDocumentId: payload.documentId,
        });
      });

      sender.on("realtime:error", () => {
        errorCount += 1;
      });
      sender.once("connect_error", (error) => {
        sender.close();
        reject(error);
      });
    });

    expect(result.resetVersion).toBe(9);
    expect(result.switchedDocumentId).toBe("doc-second");
    expect(result.errorCount).toBe(0);
  });

  it("emits realtime:error for a fresh post-reset doc.update on the current invalidated session", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        let senderStateB64 = "";

        sender.once("connect", () => {
          sender.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        sender.once("doc.sync.response", async (payload) => {
          senderStateB64 = payload.stateB64;
          await socketServer?.emitDocumentReset({
            projectId: "project-123",
            documentId: "doc-456",
            reason: "snapshot_restore",
            serverVersion: 9,
          });
        });

        sender.once("doc.reset", () => {
          sender.emit("doc.update", {
            documentId: "doc-456",
            updateB64: createIncrementalUpdateB64(
              senderStateB64,
              (document) => {
                document.getText("content").insert(14, " Revised");
              },
            ),
            clientUpdateId: "client-update-1",
          });
        });

        sender.once("realtime:error", (payload) => {
          sender.close();
          resolve(payload);
        });
        sender.once("connect_error", (error) => {
          sender.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "socket session is no longer current",
    });
  });

  it("does not broadcast post-reset doc.update events to sockets that have not rejoined", async () => {
    const collaborationService = createCollaborationService();
    let currentText = "\\section{Before}";
    let currentVersion = 1;
    const activeDocumentRegistry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: async () => ({
        kind: "yjs-update",
        update: createStateBytes(currentText),
        serverVersion: currentVersion,
      }),
      persistOnIdle: async () => {},
    });

    socketServer = await createTestSocketServer({
      workspaceService: {
        openDocument: async ({ documentId }) => ({
          workspace: createWorkspaceOpenedEvent(documentId),
          initialSync: {
            documentId,
            yjsState: createStateBytes(currentText),
            serverVersion: currentVersion,
          },
        }),
      },
      activeDocumentRegistry,
      realtimeDocumentService: {
        applyUpdate: async ({ update, buildAcceptedContext }) => ({
          serverVersion: currentVersion + 1,
          acceptedUpdate: update,
          acceptedContext: buildAcceptedContext
            ? await buildAcceptedContext({
                session: { isInvalidated: false },
                isCurrentSession: true,
              })
            : undefined,
        }),
      },
    });

    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const staleReceiver = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      staleReceiverUpdateCount: number;
      senderResetVersion: number;
      staleReceiverResetVersion: number;
      restoredSyncVersion: number;
      senderUpdateVersion: number;
    }>((resolve, reject) => {
      let senderReady = false;
      let receiverReady = false;
      let resetTriggered = false;
      let senderResetVersion: number | null = null;
      let staleReceiverResetVersion: number | null = null;
      let staleReceiverUpdateCount = 0;

      const maybeReset = async () => {
        if (!senderReady || !receiverReady || resetTriggered) {
          return;
        }

        resetTriggered = true;
        currentText = "\\section{Restored}";
        currentVersion = 9;

        await socketServer?.emitDocumentReset({
          projectId: "project-123",
          documentId: "doc-456",
          reason: "snapshot_restore",
          serverVersion: currentVersion,
        });
      };

      const maybeRejoin = () => {
        if (senderResetVersion === null || staleReceiverResetVersion === null) {
          return;
        }

        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      };

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      staleReceiver.once("connect", () => {
        staleReceiver.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.on("doc.sync.response", async (payload) => {
        if (payload.serverVersion === 1) {
          senderReady = true;
          await maybeReset();
          return;
        }

        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(
            payload.stateB64,
            (document) => {
              document.getText("content").insert(18, " Revised");
            },
          ),
          clientUpdateId: "client-update-1",
        });
      });
      staleReceiver.once("doc.sync.response", async () => {
        receiverReady = true;
        await maybeReset();
      });

      sender.once("doc.reset", (payload) => {
        senderResetVersion = payload.serverVersion;
        maybeRejoin();
      });
      staleReceiver.once("doc.reset", (payload) => {
        staleReceiverResetVersion = payload.serverVersion;
        maybeRejoin();
      });

      staleReceiver.on("doc.update", () => {
        staleReceiverUpdateCount += 1;
      });
      sender.once("doc.update", async (payload) => {
        const senderUpdateVersion = payload.serverVersion;
        await waitForSocketFlush();
        sender.close();
        staleReceiver.close();
        resolve({
          staleReceiverUpdateCount,
          senderResetVersion: senderResetVersion ?? -1,
          staleReceiverResetVersion: staleReceiverResetVersion ?? -1,
          restoredSyncVersion: currentVersion,
          senderUpdateVersion,
        });
      });
      sender.once("realtime:error", (payload) => {
        sender.close();
        staleReceiver.close();
        reject(new Error(`Unexpected sender realtime error: ${payload.code}`));
      });
      staleReceiver.once("realtime:error", (payload) => {
        sender.close();
        staleReceiver.close();
        reject(
          new Error(
            `Unexpected stale receiver realtime error: ${payload.code}`,
          ),
        );
      });
      sender.once("connect_error", (error) => {
        sender.close();
        staleReceiver.close();
        reject(error);
      });
      staleReceiver.once("connect_error", (error) => {
        sender.close();
        staleReceiver.close();
        reject(error);
      });
    });

    expect(result.senderResetVersion).toBe(9);
    expect(result.staleReceiverResetVersion).toBe(9);
    expect(result.restoredSyncVersion).toBe(9);
    expect(result.senderUpdateVersion).toBe(10);
    expect(result.staleReceiverUpdateCount).toBe(0);
  });

  it("rejects invalid doc.update payloads after join", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<{ code: string; message: string }>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", () => {
          client.emit("doc.update", {
            documentId: "doc-456",
            updateB64: "not-base64",
            clientUpdateId: "client-update-1",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "updateB64 must be a valid base64-encoded Yjs update",
    });
  });

  it("rejects decoded doc.update payloads that are not valid Yjs updates", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<{ code: string; message: string }>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", () => {
          client.emit("doc.update", {
            documentId: "doc-456",
            updateB64: Buffer.from([1, 2, 3]).toString("base64"),
            clientUpdateId: "client-update-1",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "update payload is not a valid Yjs update",
    });
  });

  it("rejects doc.update from read-only members", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("commenter", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<{ code: string; message: string }>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", (payload) => {
          client.emit("doc.update", {
            documentId: "doc-456",
            updateB64: createIncrementalUpdateB64(
              payload.stateB64,
              (document) => {
                document.getText("content").insert(14, " Comment");
              },
            ),
            clientUpdateId: "client-update-1",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "FORBIDDEN",
      message: "required project role missing",
    });
  });

  it("rejects doc.update when socket is not joined to the document", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", () => {
          client.emit("doc.update", {
            documentId: "doc-other",
            updateB64: Buffer.from([0]).toString("base64"),
            clientUpdateId: "client-update-1",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "socket is not joined to this document",
    });
  });

  it("rejects doc.update after membership revocation", async () => {
    let membershipRevoked = false;
    const accessCheck = async () => {
      if (membershipRevoked) {
        throw new ProjectNotFoundError();
      }

      return {
        project: {
          id: "project-123",
          name: "Project",
          createdAt: new Date(),
          updatedAt: new Date(),
          tombstoneAt: null,
        },
        myRole: "admin" as const,
      };
    };
    socketServer = await createTestSocketServer({
      projectAccessService: {
        requireProjectMember: accessCheck,
        requireProjectRole: accessCheck,
      },
    });
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      joinSync: DocumentSyncResponseEvent;
      error: WorkspaceErrorEvent;
    }>((resolve, reject) => {
      let joinSync: DocumentSyncResponseEvent | null = null;

      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      client.once("doc.sync.response", (payload) => {
        joinSync = payload;
        membershipRevoked = true;
        client.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(
            payload.stateB64,
            (document) => {
              document.getText("content").insert(14, " Revoked");
            },
          ),
          clientUpdateId: "client-update-1",
        });
      });

      client.once("realtime:error", (payload) => {
        client.close();
        if (!joinSync) {
          reject(new Error("Expected join sync before error"));
          return;
        }
        resolve({ joinSync, error: payload });
      });
      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(result.joinSync.serverVersion).toBe(1);
    expect(result.error).toEqual({
      code: "FORBIDDEN",
      message: "project membership required",
    });
  });

  it("returns post-commit state for doc.sync.request after accepted updates", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      initialSync: DocumentSyncResponseEvent;
      resync: DocumentSyncResponseEvent;
    }>((resolve, reject) => {
      let initialSync: DocumentSyncResponseEvent | null = null;

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.once("doc.sync.response", (payload) => {
        initialSync = payload;
        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(
            payload.stateB64,
            (document) => {
              document.getText("content").insert(14, " Revised");
            },
          ),
          clientUpdateId: "client-update-1",
        });
      });

      sender.once("doc.update.ack", () => {
        sender.emit("doc.sync.request", {
          documentId: "doc-456",
        });
      });

      sender.on("doc.sync.response", (payload) => {
        if (
          !initialSync ||
          payload.serverVersion <= initialSync.serverVersion
        ) {
          return;
        }

        sender.close();
        resolve({ initialSync, resync: payload });
      });

      sender.once("realtime:error", (payload) => {
        sender.close();
        reject(new Error(`Unexpected realtime error: ${payload.code}`));
      });
      sender.once("connect_error", (error) => {
        sender.close();
        reject(error);
      });
    });

    expect(result.resync.serverVersion).toBe(2);
    expect(decodeStateB64(result.resync.stateB64)).toBe(
      "\\section{Test} Revised",
    );
  });

  it("rejects doc.sync.request with invalid payload", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", () => {
          client.emit("doc.sync.request", {
            documentId: "",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "documentId is required",
    });
  });

  it("rejects doc.sync.request when socket is not joined to the document", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("doc.sync.response", () => {
          client.emit("doc.sync.request", {
            documentId: "doc-other",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "socket is not joined to this document",
    });
  });

  it("allows read-only members to send doc.sync.request", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("reader", testConfig.jwtSecret),
    );

    const sync = await new Promise<DocumentSyncResponseEvent>(
      (resolve, reject) => {
        let joinSyncReceived = false;

        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.on("doc.sync.response", (payload) => {
          if (!joinSyncReceived) {
            joinSyncReceived = true;
            client.emit("doc.sync.request", {
              documentId: "doc-456",
            });
            return;
          }

          client.close();
          resolve(payload);
        });

        client.once("realtime:error", (payload) => {
          client.close();
          reject(new Error(`Unexpected realtime error: ${payload.code}`));
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(sync.documentId).toBe("doc-456");
    expect(sync.serverVersion).toBe(1);
    expect(decodeStateB64(sync.stateB64)).toBe("\\section{Test}");
  });

  it("rejects doc.sync.request after membership revocation", async () => {
    let membershipRevoked = false;
    const accessCheck = async () => {
      if (membershipRevoked) {
        throw new ProjectNotFoundError();
      }

      return {
        project: {
          id: "project-123",
          name: "Project",
          createdAt: new Date(),
          updatedAt: new Date(),
          tombstoneAt: null,
        },
        myRole: "admin" as const,
      };
    };
    socketServer = await createTestSocketServer({
      projectAccessService: {
        requireProjectMember: accessCheck,
        requireProjectRole: accessCheck,
      },
    });
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      joinSync: DocumentSyncResponseEvent;
      error: WorkspaceErrorEvent;
    }>((resolve, reject) => {
      let joinSync: DocumentSyncResponseEvent | null = null;

      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      client.on("doc.sync.response", (payload) => {
        if (!joinSync) {
          joinSync = payload;
          membershipRevoked = true;
          client.emit("doc.sync.request", {
            documentId: "doc-456",
          });
          return;
        }
      });

      client.once("realtime:error", (payload) => {
        client.close();
        if (!joinSync) {
          reject(new Error("Expected join sync before error"));
          return;
        }
        resolve({ joinSync, error: payload });
      });
      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(result.joinSync.serverVersion).toBe(1);
    expect(result.error).toEqual({
      code: "FORBIDDEN",
      message: "project membership required",
    });
  });

  it("emits realtime:error for a fresh post-reset doc.sync.request on the current invalidated session", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        sender.once("connect", () => {
          sender.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        sender.once("doc.sync.response", async () => {
          await socketServer?.emitDocumentReset({
            projectId: "project-123",
            documentId: "doc-456",
            reason: "snapshot_restore",
            serverVersion: 9,
          });
        });

        sender.once("doc.reset", () => {
          sender.emit("doc.sync.request", {
            documentId: "doc-456",
          });
        });

        sender.once("realtime:error", (payload) => {
          sender.close();
          resolve(payload);
        });
        sender.once("connect_error", (error) => {
          sender.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "socket session is no longer current",
    });
  });

  it("suppresses stale doc.sync.request after a document switch", async () => {
    const syncStarted = createDeferred<void>();
    const releaseSync = createDeferred<void>();
    const collaborationService = createCollaborationService();
    const document =
      collaborationService.createDocumentFromText("\\section{Test}");
    const session = {
      projectId: "project-123",
      documentId: "doc-456",
      generation: 0,
      clientCount: 1,
      document,
      serverVersion: 1,
      isInvalidated: false,
    };

    let doc456RunExclusiveCount = 0;
    socketServer = await createTestSocketServer({
      activeDocumentRegistry: {
        join: async ({ documentId }) => {
          if (documentId === "doc-456") {
            return {
              session,
              runExclusive: async <Result>(
                task: (sessionState: typeof session) => Promise<Result>,
              ) => {
                doc456RunExclusiveCount += 1;
                if (doc456RunExclusiveCount > 1) {
                  syncStarted.resolve();
                  await releaseSync.promise;
                }
                return task(session);
              },
              leave: async () => {
                document.destroy();
              },
            };
          }

          const secondDoc =
            collaborationService.createDocumentFromText("\\section{Second}");
          const secondSession = {
            projectId: "project-123",
            documentId,
            generation: 0,
            clientCount: 1,
            document: secondDoc,
            serverVersion: 1,
            isInvalidated: false,
          };

          return {
            session: secondSession,
            runExclusive: async <Result>(
              task: (sessionState: typeof secondSession) => Promise<Result>,
            ) => task(secondSession),
            leave: async () => {
              secondDoc.destroy();
            },
          };
        },
        invalidate: () => ({ invalidatedGeneration: 0 }),
        drain: async () => ({ timedOut: false, failedCount: 0 }),
      },
    });
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      errorCount: number;
      syncResponseDocIds: string[];
      switchedDocumentId: string;
    }>((resolve, reject) => {
      let errorCount = 0;
      const syncResponseDocIds: string[] = [];

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.on("doc.sync.response", async (payload) => {
        syncResponseDocIds.push(payload.documentId);

        if (
          payload.documentId === "doc-456" &&
          syncResponseDocIds.length === 1
        ) {
          sender.emit("doc.sync.request", {
            documentId: "doc-456",
          });
          await syncStarted.promise;
          sender.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-second",
          });
          return;
        }

        if (payload.documentId === "doc-second") {
          releaseSync.resolve();
          await waitForSocketFlush();
          sender.close();
          resolve({
            errorCount,
            syncResponseDocIds,
            switchedDocumentId: payload.documentId,
          });
        }
      });

      sender.on("realtime:error", () => {
        errorCount += 1;
      });
      sender.once("connect_error", (error) => {
        sender.close();
        reject(error);
      });
    });

    expect(result.switchedDocumentId).toBe("doc-second");
    expect(result.errorCount).toBe(0);
    // Should have initial join sync for doc-456 and join sync for doc-second,
    // but NOT a second doc-456 sync response from the stale request
    expect(result.syncResponseDocIds).toEqual(["doc-456", "doc-second"]);
  });

  it("rejects workspace join when membership is revoked during queue wait", async () => {
    let membershipRevoked = false;
    const queueBlocker = createDeferred<void>();
    const collaborationService = createCollaborationService();
    const document =
      collaborationService.createDocumentFromText("\\section{Test}");
    const session = {
      projectId: "project-123",
      documentId: "doc-456",
      generation: 0,
      clientCount: 1,
      document,
      serverVersion: 1,
      isInvalidated: false,
    };
    let firstExclusiveCall = true;
    socketServer = await createTestSocketServer({
      activeDocumentRegistry: {
        join: async () => ({
          session,
          runExclusive: async <Result>(
            task: (s: typeof session) => Promise<Result>,
          ) => {
            if (firstExclusiveCall) {
              firstExclusiveCall = false;
              await queueBlocker.promise;
            }
            return task(session);
          },
          leave: async () => {
            document.destroy();
          },
        }),
        invalidate: () => ({ invalidatedGeneration: 0 }),
        drain: async () => ({ timedOut: false, failedCount: 0 }),
      },
      workspaceService: {
        openDocument: async () => ({
          workspace: createWorkspaceOpenedEvent("doc-456"),
          initialSync: {
            documentId: "doc-456",
            yjsState: document.exportUpdate(),
            serverVersion: 1,
          },
        }),
      },
      projectAccessService: {
        requireProjectMember: async () => {
          if (membershipRevoked) {
            throw new ProjectNotFoundError();
          }

          return {
            project: {
              id: "project-123",
              name: "Project",
              createdAt: new Date(),
              updatedAt: new Date(),
              tombstoneAt: null,
            },
            myRole: "admin" as const,
          };
        },
        requireProjectRole: async () => {
          if (membershipRevoked) {
            throw new ProjectNotFoundError();
          }

          return {
            project: {
              id: "project-123",
              name: "Project",
              createdAt: new Date(),
              updatedAt: new Date(),
              tombstoneAt: null,
            },
            myRole: "admin" as const,
          };
        },
      },
    });
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });

        // Revoke membership while the queue is blocked, then release
        void (async () => {
          await waitForSocketFlush();
          membershipRevoked = true;
          queueBlocker.resolve();
        })();
      },
    );

    expect(errorPayload).toEqual({
      code: "FORBIDDEN",
      message: "project membership required",
    });
  });

  it("delivers accepted updates to multiple receivers independently", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const receiver1 = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );
    const receiver2 = socketServer.connect(
      signToken("commenter", testConfig.jwtSecret),
    );

    const result = await new Promise<{
      receiver1Update: { documentId: string; serverVersion: number };
      receiver2Update: { documentId: string; serverVersion: number };
    }>((resolve, reject) => {
      let senderReady = false;
      let receiver1Ready = false;
      let receiver2Ready = false;
      let senderStateB64 = "";
      let receiver1Update: {
        documentId: string;
        serverVersion: number;
      } | null = null;
      let receiver2Update: {
        documentId: string;
        serverVersion: number;
      } | null = null;

      const resolveIfReady = () => {
        if (!receiver1Update || !receiver2Update) {
          return;
        }

        sender.close();
        receiver1.close();
        receiver2.close();
        resolve({ receiver1Update, receiver2Update });
      };

      const maybeSendUpdate = () => {
        if (!senderReady || !receiver1Ready || !receiver2Ready) {
          return;
        }

        sender.emit("doc.update", {
          documentId: "doc-456",
          updateB64: createIncrementalUpdateB64(senderStateB64, (document) => {
            document.getText("content").insert(14, " Revised");
          }),
          clientUpdateId: "client-update-1",
        });
      };

      sender.once("connect", () => {
        sender.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      receiver1.once("connect", () => {
        receiver1.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
      receiver2.once("connect", () => {
        receiver2.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      sender.once("doc.sync.response", (payload) => {
        senderReady = true;
        senderStateB64 = payload.stateB64;
        maybeSendUpdate();
      });
      receiver1.once("doc.sync.response", () => {
        receiver1Ready = true;
        maybeSendUpdate();
      });
      receiver2.once("doc.sync.response", () => {
        receiver2Ready = true;
        maybeSendUpdate();
      });

      receiver1.once("doc.update", (payload) => {
        receiver1Update = payload;
        resolveIfReady();
      });
      receiver2.once("doc.update", (payload) => {
        receiver2Update = payload;
        resolveIfReady();
      });

      sender.once("realtime:error", (payload) => {
        sender.close();
        receiver1.close();
        receiver2.close();
        reject(new Error(`Unexpected sender error: ${payload.code}`));
      });
      sender.once("connect_error", (error) => {
        sender.close();
        receiver1.close();
        receiver2.close();
        reject(error);
      });
    });

    expect(result.receiver1Update.documentId).toBe("doc-456");
    expect(result.receiver1Update.serverVersion).toBe(2);
    expect(result.receiver2Update.documentId).toBe("doc-456");
    expect(result.receiver2Update.serverVersion).toBe(2);
  });

  it("rejects doc.update sent before joining any workspace", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("doc.update", {
            documentId: "doc-456",
            updateB64: Buffer.from([0]).toString("base64"),
            clientUpdateId: "client-update-1",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "socket is not joined to this document",
    });
  });

  it("rejects doc.sync.request sent before joining any workspace", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const errorPayload = await new Promise<WorkspaceErrorEvent>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("doc.sync.request", {
            documentId: "doc-456",
          });
        });

        client.once("realtime:error", (payload) => {
          client.close();
          resolve(payload);
        });
        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(errorPayload).toEqual({
      code: "INVALID_REQUEST",
      message: "socket is not joined to this document",
    });
  });

  it("same client gets restored state after rejoin following doc.reset", async () => {
    const collaborationService = createCollaborationService();
    let currentText = "\\section{Before}";
    let currentVersion = 1;
    const activeDocumentRegistry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: async () => ({
        kind: "yjs-update",
        update: createStateBytes(currentText),
        serverVersion: currentVersion,
      }),
      persistOnIdle: async () => {},
    });

    socketServer = await createTestSocketServer({
      workspaceService: {
        openDocument: async ({ documentId }) => ({
          workspace: createWorkspaceOpenedEvent(documentId),
          initialSync: {
            documentId,
            yjsState: createStateBytes(currentText),
            serverVersion: currentVersion,
          },
        }),
      },
      activeDocumentRegistry,
    });

    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    try {
      const firstSync = await joinAndWaitForSync(client, "doc-456");

      expect(firstSync.serverVersion).toBe(1);
      expect(decodeStateB64(firstSync.stateB64)).toBe("\\section{Before}");

      const resetPromise = waitForEvent<{
        documentId: string;
        reason: string;
        serverVersion: number;
      }>(client, "doc.reset");

      currentText = "\\section{Restored}";
      currentVersion = 9;

      await socketServer.emitDocumentReset({
        projectId: "project-123",
        documentId: "doc-456",
        reason: "snapshot_restore",
        serverVersion: currentVersion,
      });
      const resetEvent = await resetPromise;

      expect(resetEvent).toEqual({
        documentId: "doc-456",
        reason: "snapshot_restore",
        serverVersion: currentVersion,
      });

      const secondSync = await joinAndWaitForSync(client, "doc-456");

      expect(secondSync.serverVersion).toBe(currentVersion);
      expect(decodeStateB64(secondSync.stateB64)).toBe("\\section{Restored}");
    } finally {
      client.close();
    }
  });

  it("broadcasts presence.update to peers in the same workspace room but not to the sender", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const receiver = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    try {
      await joinAndWaitForSync(sender, "doc-456");
      await joinAndWaitForSync(receiver, "doc-456");

      const receiverPromise = new Promise<PresenceUpdateEvent>((resolve) => {
        receiver.once("presence.update", resolve);
      });

      let senderReceivedPresence = false;
      sender.once("presence.update", () => {
        senderReceivedPresence = true;
      });

      sender.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });

      const received = await receiverPromise;

      expect(received).toEqual({
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });

      await waitForSocketFlush();
      expect(senderReceivedPresence).toBe(false);
    } finally {
      sender.close();
      receiver.close();
    }
  });

  it("rejects presence.update when the socket is not joined to the referenced document", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    try {
      await joinAndWaitForSync(client, "doc-456");

      const errorPromise = new Promise<WorkspaceErrorEvent>((resolve) => {
        client.once("realtime:error", resolve);
      });

      client.emit("presence.update", {
        documentId: "doc-other",
        awarenessB64: "AQIDBA==",
      });

      const error = await errorPromise;

      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("socket is not joined to this document");
    } finally {
      client.close();
    }
  });

  it("rejects presence.update before joining any workspace", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    try {
      await new Promise<void>((resolve) => {
        client.once("connect", resolve);
      });

      const errorPromise = new Promise<WorkspaceErrorEvent>((resolve) => {
        client.once("realtime:error", resolve);
      });

      client.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });

      const error = await errorPromise;

      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("socket is not joined to this document");
    } finally {
      client.close();
    }
  });

  it("rejects presence.update with missing or invalid fields", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    try {
      await joinAndWaitForSync(client, "doc-456");

      const collectError = () =>
        new Promise<WorkspaceErrorEvent>((resolve) => {
          client.once("realtime:error", resolve);
        });

      // Missing documentId
      let errorPromise = collectError();
      client.emit("presence.update", {
        documentId: "",
        awarenessB64: "AQIDBA==",
      } as never);
      let error = await errorPromise;
      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("documentId is required");

      // Missing awarenessB64
      errorPromise = collectError();
      client.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "",
      } as never);
      error = await errorPromise;
      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("awarenessB64 is required");

      // Invalid base64
      errorPromise = collectError();
      client.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "not-valid-base64!",
      });
      error = await errorPromise;
      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("awarenessB64 must be valid base64");

      // Oversized awarenessB64
      errorPromise = collectError();
      const oversizedB64 = Buffer.from("x".repeat(6200)).toString("base64");
      client.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: oversizedB64,
      });
      error = await errorPromise;
      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toContain("exceeds maximum length");

      // Non-object payload
      errorPromise = collectError();
      client.emit("presence.update", "not an object" as never);
      error = await errorPromise;
      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("presence.update payload must be an object");
    } finally {
      client.close();
    }
  });

  it("allows any role including reader to send presence.update", async () => {
    socketServer = await createTestSocketServer();
    const reader = socketServer.connect(
      signToken("reader", testConfig.jwtSecret),
    );
    const receiver = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    try {
      await joinAndWaitForSync(reader, "doc-456");
      await joinAndWaitForSync(receiver, "doc-456");

      const receiverPromise = new Promise<PresenceUpdateEvent>((resolve) => {
        receiver.once("presence.update", resolve);
      });

      reader.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });

      const received = await receiverPromise;

      expect(received).toEqual({
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });
    } finally {
      reader.close();
      receiver.close();
    }
  });

  it("does not broadcast presence.update to peers on a different document", async () => {
    socketServer = await createTestSocketServer();
    const sender = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );
    const otherDocPeer = socketServer.connect(
      signToken("editor", testConfig.jwtSecret),
    );

    try {
      await joinAndWaitForSync(sender, "doc-456");
      await joinAndWaitForSync(otherDocPeer, "doc-second");

      let otherDocPeerReceivedPresence = false;
      otherDocPeer.once("presence.update", () => {
        otherDocPeerReceivedPresence = true;
      });

      sender.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });

      await waitForSocketFlush();
      expect(otherDocPeerReceivedPresence).toBe(false);
    } finally {
      sender.close();
      otherDocPeer.close();
    }
  });

  it("rejects presence.update for old document after switching to a new document", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect(
      signToken("alice", testConfig.jwtSecret),
    );

    try {
      await joinAndWaitForSync(client, "doc-456");
      await joinAndWaitForSync(client, "doc-second");

      const errorPromise = new Promise<WorkspaceErrorEvent>((resolve) => {
        client.once("realtime:error", resolve);
      });

      client.emit("presence.update", {
        documentId: "doc-456",
        awarenessB64: "AQIDBA==",
      });

      const error = await errorPromise;

      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe("socket is not joined to this document");
    } finally {
      client.close();
    }
  });

  it("calls touchProjectTimestamp with the correct project ID on disconnect", async () => {
    const touchProjectTimestamp = vi.fn().mockResolvedValue(undefined);
    socketServer = await createTestSocketServer({ touchProjectTimestamp });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    await new Promise<void>((resolve, reject) => {
      client.once("workspace:opened", () => resolve());
      client.once("connect_error", reject);
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
    });

    client.close();
    await waitForSocketFlush();

    expect(touchProjectTimestamp).toHaveBeenCalledWith("project-123");
  });

  it("does not call touchProjectTimestamp when disconnecting without joining a project", async () => {
    const touchProjectTimestamp = vi.fn().mockResolvedValue(undefined);
    socketServer = await createTestSocketServer({ touchProjectTimestamp });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("connect_error", reject);
    });

    client.close();
    await waitForSocketFlush();

    expect(touchProjectTimestamp).not.toHaveBeenCalled();
  });

  it("does not crash when touchProjectTimestamp rejects on disconnect", async () => {
    const touchProjectTimestamp = vi
      .fn()
      .mockRejectedValue(new Error("db connection lost"));
    socketServer = await createTestSocketServer({ touchProjectTimestamp });
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    await new Promise<void>((resolve, reject) => {
      client.once("workspace:opened", () => resolve());
      client.once("connect_error", reject);
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });
    });

    client.close();
    await waitForSocketFlush();

    expect(touchProjectTimestamp).toHaveBeenCalledWith("project-123");
  });
});

function createSequencedWorkspaceService(
  resultsByDocumentId: Record<string, Promise<WorkspaceOpenResult>>,
): WorkspaceService {
  return {
    openDocument: async ({ projectId, documentId }) => {
      const result = resultsByDocumentId[documentId];

      if (!result) {
        throw new Error(`Unexpected document ${documentId} for ${projectId}`);
      }

      return result;
    },
  };
}

function joinAndWaitForSync(
  client: ReturnType<TestSocketServer["connect"]>,
  documentId: string,
) {
  return new Promise<DocumentSyncResponseEvent>((resolve, reject) => {
    const joinWorkspace = () => {
      client.emit("workspace:join", {
        projectId: "project-123",
        documentId,
      });
    };

    if (client.connected) {
      joinWorkspace();
    } else {
      client.once("connect", joinWorkspace);
    }

    client.once("doc.sync.response", resolve);
    client.once("realtime:error", (payload) => {
      reject(new Error(`Unexpected realtime error: ${payload.code}`));
    });
    client.once("connect_error", reject);
  });
}

function waitForEvent<Event>(
  client: ReturnType<TestSocketServer["connect"]>,
  eventName: string,
) {
  return new Promise<Event>((resolve) => {
    client.once(eventName, resolve);
  });
}

function createWorkspaceOpenResult(documentId: string): WorkspaceOpenResult {
  return {
    workspace: createWorkspaceOpenedEvent(documentId),
    initialSync: {
      documentId,
      yjsState: createStateBytes(`\\section{${documentId}}`),
      serverVersion: 1,
    },
  };
}

function createWorkspaceOpenedEvent(documentId: string): WorkspaceOpenedEvent {
  return {
    projectId: "project-123",
    document: {
      id: documentId,
      path: `/${documentId}.tex`,
      kind: "text",
      mime: "text/x-tex",
      createdAt: "2026-03-01T12:00:00.000Z",
      updatedAt: "2026-03-01T12:00:00.000Z",
    },
    content: null,
  };
}

function createStaticActiveDocumentRegistry(
  documentsById: Record<
    string,
    {
      text: string;
      serverVersion: number;
    }
  >,
) {
  return {
    join: async ({ documentId }: { documentId: string }) => {
      const documentState = documentsById[documentId];

      if (!documentState) {
        throw new Error(`Unexpected active document ${documentId}`);
      }

      const document = createCollaborationService().createDocumentFromText(
        documentState.text,
      );
      const session = {
        projectId: "project-123",
        documentId,
        generation: 0,
        clientCount: 1,
        document,
        serverVersion: documentState.serverVersion,
        isInvalidated: false,
      };

      return {
        session,
        runExclusive: async <Result>(
          task: (sessionState: typeof session) => Promise<Result>,
        ) => task(session),
        leave: async () => {
          document.destroy();
        },
      };
    },
    invalidate: () => ({ invalidatedGeneration: 0 }),
    drain: async (_timeoutMs: number) => ({ timedOut: false, failedCount: 0 }),
  };
}

function createStateBytes(text: string): Uint8Array {
  const document = createCollaborationService().createDocumentFromText(text);

  try {
    return document.exportUpdate();
  } finally {
    document.destroy();
  }
}

function decodeStateB64(stateB64: string): string {
  const document = createCollaborationService().createDocumentFromUpdate(
    Buffer.from(stateB64, "base64"),
  );

  try {
    return document.getText();
  } finally {
    document.destroy();
  }
}

function createIncrementalUpdateB64(
  stateB64: string,
  mutate: (document: Y.Doc) => void,
) {
  const baseDocument = new Y.Doc();
  const nextDocument = new Y.Doc();

  try {
    const state = Buffer.from(stateB64, "base64");
    Y.applyUpdate(baseDocument, state);
    Y.applyUpdate(nextDocument, state);
    mutate(nextDocument);

    return Buffer.from(
      Y.encodeStateAsUpdate(nextDocument, Y.encodeStateVector(baseDocument)),
    ).toString("base64");
  } finally {
    baseDocument.destroy();
    nextDocument.destroy();
  }
}

function applyUpdateToStateB64(stateB64: string, updateB64: string): string {
  const document = new Y.Doc();

  try {
    Y.applyUpdate(document, Buffer.from(stateB64, "base64"));
    Y.applyUpdate(document, Buffer.from(updateB64, "base64"));

    return document.getText("content").toString();
  } finally {
    document.destroy();
  }
}

async function waitForSocketFlush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 25);
  });
}
