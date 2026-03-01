import { afterEach, describe, expect, it } from "vitest";
import { signToken } from "../services/auth";
import { testConfig } from "../test/helpers/appFactory";
import { createTestSocketServer, type TestSocketServer } from "../test/helpers/socket";

describe("socket server", () => {
  let socketServer: TestSocketServer | undefined;

  afterEach(async () => {
    if (socketServer) {
      await socketServer.close();
      socketServer = undefined;
    }
  });

  it("sends server:hello after a valid authenticated connection", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const hello = await new Promise<{ userId: string; ts: number }>((resolve, reject) => {
      client.once("server:hello", (payload) => {
        client.close();
        resolve(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(hello.userId).toBe("alice");
    expect(typeof hello.ts).toBe("number");
  });

  it("responds to client:ping with server:pong", async () => {
    socketServer = await createTestSocketServer();
    const token = signToken("alice", testConfig.jwtSecret);
    const client = socketServer.connect(token);

    const pong = await new Promise<{ n: number; ts: number }>((resolve, reject) => {
      client.once("server:hello", () => {
        client.emit("client:ping", { n: 7 });
      });

      client.once("server:pong", (payload) => {
        client.close();
        resolve(payload);
      });

      client.once("connect_error", (error) => {
        client.close();
        reject(error);
      });
    });

    expect(pong.n).toBe(7);
    expect(typeof pong.ts).toBe("number");
  });

  it("rejects connections without a token", async () => {
    socketServer = await createTestSocketServer();
    const client = socketServer.connect();

    const message = await new Promise<string>((resolve) => {
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

    const message = await new Promise<string>((resolve) => {
      client.once("connect_error", (error) => {
        client.close();
        resolve(error.message);
      });
    });

    expect(message).toBe("invalid token");
  });
});
