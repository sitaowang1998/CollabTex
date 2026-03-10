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
import { type SnapshotService } from "../../services/snapshot.js";
import { createWorkspaceService } from "../../services/workspace.js";
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

export async function createTestSocketServer(options?: {
  snapshotService?: SnapshotService;
}): Promise<TestSocketServer> {
  const projectRepository = createSocketTestProjectRepository();
  const documentRepository = createSocketTestDocumentRepository();
  const snapshotService =
    options?.snapshotService ?? createStubSnapshotService();
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
      projectRepository,
    }),
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
  });
  const server = http.createServer(app);
  const io = createSocketServer(server, testConfig, {
    workspaceService: createWorkspaceService({
      projectAccessService: {
        requireProjectMember: async (projectId, userId) => {
          const project = await projectRepository.findForUser(
            projectId,
            userId,
          );

          if (!project) {
            throw new ProjectNotFoundError();
          }

          return project;
        },
        requireProjectRole: async () => {
          throw new Error("Not implemented for socket tests");
        },
      },
      documentRepository,
      snapshotService,
    }),
  });

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

function createStubSnapshotService(): SnapshotService {
  return {
    loadDocumentContent: async (document) => {
      if (document.kind === "binary") {
        return null;
      }

      return "\\section{Test}";
    },
    captureProjectSnapshot: async () => ({
      id: "snapshot-1",
      projectId: "project-123",
      storagePath: "project-123/snapshot.json",
      message: null,
      authorId: "alice",
      createdAt: new Date(),
    }),
  };
}

function createSocketTestProjectRepository() {
  return {
    createForOwner: async () => {
      throw new Error("Not implemented for socket tests");
    },
    listForUser: async () => [],
    findForUser: async (projectId: string, userId: string) => {
      if (projectId !== "project-123" || userId !== "alice") {
        return null;
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
    updateName: async () => {
      throw new ProjectNotFoundError();
    },
    softDelete: async () => {
      throw new ProjectNotFoundError();
    },
  };
}

function createSocketTestDocumentRepository() {
  return {
    findById: async (projectId: string, documentId: string) => {
      if (projectId !== "project-123" || documentId !== "doc-456") {
        return null;
      }

      return {
        id: "doc-456",
        projectId: "project-123",
        path: "/main.tex",
        kind: "text" as const,
        mime: "text/x-tex",
        contentHash: null,
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        updatedAt: new Date("2026-03-01T12:00:00.000Z"),
      };
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
