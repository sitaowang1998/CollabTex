import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceErrorEvent,
  WorkspaceOpenedEvent,
} from "@collab-tex/shared";
import type { WorkspaceService } from "../services/workspace.js";
import { signToken } from "../services/auth.js";
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

  it("emits the initial workspace payload after an authenticated join", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const opened = await new Promise<{
      projectId: string;
      document: {
        id: string;
        path: string;
        kind: string;
        mime: string | null;
        createdAt: string;
        updatedAt: string;
      };
      content: string | null;
    }>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      client.once("workspace:opened", (payload) => {
        client.close();
        resolve(payload);
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
      content: "\\section{Test}",
    });
  });

  it("opens binary documents with null content", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const opened = await new Promise<{
      projectId: string;
      document: {
        id: string;
        path: string;
        kind: string;
        mime: string | null;
        createdAt: string;
        updatedAt: string;
      };
      content: string | null;
    }>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-binary",
        });
      });

      client.once("workspace:opened", (payload) => {
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
    });

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

  it("suppresses stale workspace:opened events when a newer join finishes first", async () => {
    const firstJoin = createDeferred<WorkspaceOpenedEvent>();
    const secondJoin = createDeferred<WorkspaceOpenedEvent>();
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
        secondJoin.resolve(createWorkspaceOpenedEvent("doc-second"));
      });

      client.on("workspace:opened", async (payload) => {
        openedEvents.push(payload);

        if (payload.document.id !== "doc-second") {
          return;
        }

        firstJoin.resolve(createWorkspaceOpenedEvent("doc-first"));
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

  it("suppresses stale realtime:error events when a newer join succeeds", async () => {
    const firstJoin = createDeferred<WorkspaceOpenedEvent>();
    const secondJoin = createDeferred<WorkspaceOpenedEvent>();
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
        secondJoin.resolve(createWorkspaceOpenedEvent("doc-second"));
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
});

function createSequencedWorkspaceService(
  resultsByDocumentId: Record<string, Promise<WorkspaceOpenedEvent>>,
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
    content: `\\section{${documentId}}`,
  };
}

async function waitForSocketFlush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 25);
  });
}
