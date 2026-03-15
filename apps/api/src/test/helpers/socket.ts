import http from "http";
import type { AddressInfo } from "net";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { createHttpApp } from "../../http/app.js";
import { createAuthService } from "../../services/auth.js";
import { createCollaborationService } from "../../services/collaboration.js";
import type { CurrentTextStateService } from "../../services/currentTextState.js";
import { UnsupportedCurrentTextStateDocumentError } from "../../services/currentTextState.js";
import type { DocumentService } from "../../services/document.js";
import type { MembershipService } from "../../services/membership.js";
import {
  createProjectService,
  ProjectNotFoundError,
} from "../../services/project.js";
import { type SnapshotService } from "../../services/snapshot.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
import {
  createWorkspaceService,
  type WorkspaceService,
} from "../../services/workspace.js";
import {
  createSocketDocumentResetPublisher,
  createSocketServer,
} from "../../ws/socketServer.js";
import { testConfig } from "./appFactory.js";
import {
  createTestPasswordHasher,
  TEST_DUMMY_PASSWORD_HASH,
} from "./passwordHasher.js";

export type TestSocketServer = {
  connect: (token?: string) => ClientSocket;
  emitDocumentReset: (input: {
    projectId: string;
    documentId: string;
    reason: string;
  }) => Promise<void>;
  close: () => Promise<void>;
};

export async function createTestSocketServer(options?: {
  snapshotService?: SnapshotService;
  workspaceService?: WorkspaceService;
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
    snapshotManagementService: createStubSnapshotManagementService(),
  });
  const server = http.createServer(app);
  const workspaceService =
    options?.workspaceService ??
    createWorkspaceService({
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
      currentTextStateService:
        createStubCurrentTextStateService(snapshotService),
    });
  const io = createSocketServer(server, testConfig, {
    workspaceService,
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
    emitDocumentReset: async (input) => {
      await createSocketDocumentResetPublisher(io).emitDocumentReset(input);
    },
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
    listProjectSnapshots: async () => [],
    restoreProjectSnapshot: async () => {
      throw new Error("Not implemented for socket tests");
    },
  };
}

function createStubCurrentTextStateService(
  snapshotService: SnapshotService,
): Pick<CurrentTextStateService, "loadOrHydrate"> {
  const collaborationService = createCollaborationService();

  return {
    loadOrHydrate: async (document) => {
      if (document.kind !== "text") {
        throw new UnsupportedCurrentTextStateDocumentError();
      }

      const hydratedContent =
        await snapshotService.loadDocumentContent(document);
      const hydratedDocument = collaborationService.createDocumentFromText(
        typeof hydratedContent === "string" ? hydratedContent : "",
      );

      try {
        return {
          documentId: document.id,
          yjsState: hydratedDocument.exportUpdate(),
          textContent: hydratedDocument.getText(),
          version: 1,
          createdAt: new Date("2026-03-01T12:00:00.000Z"),
          updatedAt: new Date("2026-03-01T12:00:00.000Z"),
        };
      } finally {
        hydratedDocument.destroy();
      }
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for socket tests");
    },
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
      if (projectId !== "project-123") {
        return null;
      }

      if (documentId === "doc-456") {
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
      }

      if (documentId === "doc-binary") {
        return {
          id: "doc-binary",
          projectId: "project-123",
          path: "/figure.png",
          kind: "binary" as const,
          mime: "image/png",
          contentHash: null,
          createdAt: new Date("2026-03-01T12:00:00.000Z"),
          updatedAt: new Date("2026-03-01T12:00:00.000Z"),
        };
      }

      return null;
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
