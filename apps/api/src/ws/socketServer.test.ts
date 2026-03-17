import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type {
  DocumentSyncResponseEvent,
  WorkspaceErrorEvent,
  WorkspaceOpenedEvent,
} from "@collab-tex/shared";
import { signToken } from "../services/auth.js";
import { createCollaborationService } from "../services/collaboration.js";
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

  it("acks accepted updates to the sender and broadcasts them to other joined sockets", async () => {
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
      senderStateB64: string;
      senderBroadcastCount: number;
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
      let senderBroadcastCount = 0;

      const resolveIfReady = () => {
        if (!ack || !update) {
          return;
        }

        sender.close();
        receiver.close();
        resolve({ ack, update, senderStateB64, senderBroadcastCount });
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

      sender.on("doc.update", () => {
        senderBroadcastCount += 1;
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
    expect(result.senderBroadcastCount).toBe(0);
    expect(
      applyUpdateToStateB64(result.senderStateB64, result.update.updateB64),
    ).toBe("\\section{Test} Revised");
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
