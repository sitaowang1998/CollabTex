import http from "http";
import type { AddressInfo } from "net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { createHttpApp } from "../../http/app.js";
import { createArgon2PasswordHasher } from "../../infrastructure/auth/argon2PasswordHasher.js";
import { createAuthService } from "../../services/auth.js";
import { createSocketServer } from "../../ws/socketServer.js";
import { testConfig } from "./appFactory.js";

export type TestSocketServer = {
  connect: (token?: string) => ClientSocket;
  close: () => Promise<void>;
};

export async function createTestSocketServer(): Promise<TestSocketServer> {
  const app = createHttpApp(testConfig, {
    authService: createAuthService({
      userRepository: {
        findByEmail: async () => null,
        findById: async () => null,
        create: async () => {
          throw new Error("Not implemented for socket tests");
        },
      },
      passwordHasher: createArgon2PasswordHasher(),
      jwtSecret: testConfig.jwtSecret,
    }),
  });
  const server = http.createServer(app);
  const io = createSocketServer(server, testConfig);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    connect: (token?: string) =>
      createClient(baseUrl, {
        auth: token ? { token } : undefined,
        transports: ["websocket"],
        forceNew: true,
      }),
    close: async () => {
      // Socket.IO closes the attached HTTP server as part of io.close().
      await new Promise<void>((resolve, reject) => {
        io.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
