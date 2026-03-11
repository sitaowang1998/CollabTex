import { afterEach, describe, expect, it } from "vitest";
import type {
  WorkspaceErrorEvent,
  WorkspaceOpenedEvent,
} from "@collab-tex/shared";
import type { WorkspaceService } from "../services/workspace.js";
import { signToken } from "../services/auth.js";
import { testConfig } from "../test/helpers/appFactory.js";
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

  it("emits workspace:error when the user is not a project member", async () => {
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

        client.once("workspace:error", (payload) => {
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

  it("emits workspace:error for an invalid workspace join payload", async () => {
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

      client.once("workspace:error", (payload) => {
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

  it("emits workspace:error when the document is missing", async () => {
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

        client.once("workspace:error", (payload) => {
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

  it("emits a generic unavailable error for unexpected workspace failures", async () => {
    socketServer = await createTestSocketServer({
      snapshotService: {
        loadDocumentContent: async () => {
          throw new Error("disk path leaked");
        },
        captureProjectSnapshot: async () => {
          throw new Error("Not implemented for socket tests");
        },
      },
    });
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

        client.once("workspace:error", (payload) => {
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

      client.on("workspace:error", (payload) => {
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

  it("suppresses stale workspace:error events when a newer join succeeds", async () => {
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

      client.on("workspace:error", (payload) => {
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function waitForSocketFlush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 25);
  });
}
