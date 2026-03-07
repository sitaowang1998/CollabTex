import { afterEach, describe, expect, it } from "vitest";
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

  it("acknowledges a valid workspace join after an authenticated connection", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const joined = await new Promise<{
      userId: string;
      projectId: string;
      documentId: string;
    }>((resolve, reject) => {
      client.once("connect", () => {
        client.emit("workspace:join", {
          projectId: "project-123",
          documentId: "doc-456",
        });
      });

      client.once("workspace:joined", (payload) => {
        client.close();
        resolve(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(joined).toEqual({
      userId: "alice",
      projectId: "project-123",
      documentId: "doc-456",
    });
  });

  it("emits workspace:open after a valid workspace join", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const opened = await new Promise<{ projectId: string; documentId: string }>(
      (resolve, reject) => {
        client.once("connect", () => {
          client.emit("workspace:join", {
            projectId: "project-123",
            documentId: "doc-456",
          });
        });

        client.once("workspace:open", (payload) => {
          client.close();
          resolve(payload);
        });

        client.once("connect_error", (error) => {
          client.close();
          reject(error);
        });
      },
    );

    expect(opened).toEqual({
      projectId: "project-123",
      documentId: "doc-456",
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
});
