import http from "http";
import type { AddressInfo } from "net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { createHttpApp } from "../../http/app.js";
import { createAuthService } from "../../services/auth.js";
import type { DocumentService } from "../../services/document.js";
import type { MembershipService } from "../../services/membership.js";
import {
  createProjectService,
  ProjectNotFoundError,
} from "../../services/project.js";
import { createSocketServer } from "../../ws/socketServer.js";
import { testConfig } from "./appFactory.js";
import {
  createTestPasswordHasher,
  TEST_DUMMY_PASSWORD_HASH,
} from "./passwordHasher.js";

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
      passwordHasher: createTestPasswordHasher(),
      jwtSecret: testConfig.jwtSecret,
      dummyPasswordHash: TEST_DUMMY_PASSWORD_HASH,
    }),
    projectService: createProjectService({
      projectRepository: {
        createForOwner: async () => {
          throw new Error("Not implemented for socket tests");
        },
        listForUser: async () => [],
        findForUser: async () => null,
        updateName: async () => {
          throw new ProjectNotFoundError();
        },
        softDelete: async () => {
          throw new ProjectNotFoundError();
        },
      },
    }),
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
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

function createStubDocumentService(): DocumentService {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("Not implemented for socket tests");
    },
    createFolder: async () => {
      throw new Error("Not implemented for socket tests");
    },
    moveNode: async () => {
      throw new Error("Not implemented for socket tests");
    },
    renameNode: async () => {
      throw new Error("Not implemented for socket tests");
    },
    deleteNode: async () => {
      throw new Error("Not implemented for socket tests");
    },
    getFileContent: async () => {
      throw new Error("Not implemented for socket tests");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for socket tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for socket tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for socket tests");
    },
  };
}
