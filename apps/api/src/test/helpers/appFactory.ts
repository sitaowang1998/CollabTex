import { createHttpApp } from "../../http/app.js";
import type { AppConfig } from "../../config/appConfig.js";
import {
  createAuthService,
  DuplicateEmailError,
  type AuthUserRepository,
} from "../../services/auth.js";
import {
  createDocumentService,
  type DocumentRepository,
  type StoredDocument,
} from "../../services/document.js";
import {
  createProjectService,
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  type ProjectRepository,
} from "../../services/project.js";
import type { BinaryContentService } from "../../services/binaryContent.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
import type { CommentService } from "../../services/commentService.js";
import type { MembershipService } from "../../services/membership.js";
import { type SnapshotService } from "../../services/snapshot.js";
import { type SnapshotRefreshTrigger } from "../../services/snapshotRefresh.js";
import {
  createTestPasswordHasher,
  TEST_DUMMY_PASSWORD_HASH,
} from "./passwordHasher.js";

const INVALID_TEST_DATABASE_URL =
  "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 0,
  jwtSecret: "test_secret",
  clientOrigin: "http://localhost:5173",
  databaseUrl: INVALID_TEST_DATABASE_URL,
  storage: {
    storageBackend: "local",
    snapshotStorageRoot: "/tmp/collabtex-test-snapshots",
    compileStorageRoot: "/tmp/collabtex-test-compiles",
    binaryContentStorageRoot: "/tmp/collabtex-test-binary-content",
  },
  compileTimeoutMs: 60000,
  compileDockerImage: "texlive/texlive:latest-small",
  shutdownDrainTimeoutMs: 5000,
};

export function createTestApp() {
  const userRepository = createInMemoryUserRepository();
  const authService = createAuthService({
    userRepository,
    passwordHasher: createTestPasswordHasher(),
    jwtSecret: testConfig.jwtSecret,
    dummyPasswordHash: TEST_DUMMY_PASSWORD_HASH,
  });
  const projectService = createProjectService({
    projectRepository: createInMemoryProjectRepository(),
  });
  const documentService = createDocumentService({
    documentRepository: createInMemoryDocumentRepository(),
    projectAccessService: {
      requireProjectMember: async () => ({
        project: {
          id: "project-1",
          name: "Project",
          createdAt: new Date(),
          updatedAt: new Date(),
          tombstoneAt: null,
        },
        myRole: "admin",
      }),
      requireProjectRole: async () => ({
        project: {
          id: "project-1",
          name: "Project",
          createdAt: new Date(),
          updatedAt: new Date(),
          tombstoneAt: null,
        },
        myRole: "admin",
      }),
    },
    snapshotService: createInMemorySnapshotService(),
    snapshotRefreshTrigger: createNoopSnapshotRefreshTrigger(),
    binaryContentStore: { delete: async () => {} },
  });
  const membershipService = createStubMembershipService();

  return createHttpApp(testConfig, {
    authService,
    binaryContentService: createStubBinaryContentService(),
    commentService: createStubCommentService(),
    compileDispatchService: {
      compile: async () => {
        throw new Error("stub");
      },
    },
    compileRetrievalService: {
      getLatestPdf: async () => {
        throw new Error("stub");
      },
    },
    documentService,
    membershipService,
    projectService,
    snapshotManagementService: createStubSnapshotManagementService(),
  });
}

function createInMemoryUserRepository(): AuthUserRepository {
  const usersById = new Map<
    string,
    { id: string; email: string; name: string; passwordHash: string }
  >();
  let nextId = 1;

  return {
    findByEmail: async (email) => {
      for (const user of usersById.values()) {
        if (user.email === email) {
          return user;
        }
      }

      return null;
    },
    findById: async (id) => usersById.get(id) ?? null,
    create: async ({ email, name, passwordHash }) => {
      for (const user of usersById.values()) {
        if (user.email === email) {
          throw new DuplicateEmailError();
        }
      }

      const user = {
        id: `user-${nextId}`,
        email,
        name,
        passwordHash,
      };
      nextId += 1;
      usersById.set(user.id, user);

      return user;
    },
  };
}

function createInMemoryProjectRepository(): ProjectRepository {
  const projectsById = new Map<
    string,
    {
      id: string;
      name: string;
      createdAt: Date;
      updatedAt: Date;
      tombstoneAt: Date | null;
    }
  >();
  const membershipsByProjectId = new Map<string, Map<string, "admin">>();
  let nextProjectId = 1;

  return {
    createForOwner: async ({ ownerUserId, name }) => {
      const now = new Date();
      const project = {
        id: `project-${nextProjectId}`,
        name,
        createdAt: now,
        updatedAt: now,
        tombstoneAt: null,
      };

      nextProjectId += 1;
      projectsById.set(project.id, project);
      membershipsByProjectId.set(project.id, new Map([[ownerUserId, "admin"]]));

      return project;
    },
    findActiveById: async (projectId) => {
      const project = projectsById.get(projectId);

      if (!project || project.tombstoneAt) {
        return null;
      }

      return project;
    },
    listForUser: async (userId) => {
      const projects = [...projectsById.values()]
        .filter((project) => {
          if (project.tombstoneAt) {
            return false;
          }

          return membershipsByProjectId.get(project.id)?.has(userId) ?? false;
        })
        .sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
        );

      return projects.map((project) => ({
        project,
        myRole: "admin" as const,
      }));
    },
    findForUser: async (projectId, userId) => {
      const project = projectsById.get(projectId);

      if (!project || project.tombstoneAt) {
        return null;
      }

      const role = membershipsByProjectId.get(projectId)?.get(userId);

      if (!role) {
        return null;
      }

      return {
        project,
        myRole: role,
      };
    },
    updateName: async ({ projectId, actorUserId, name }) => {
      const project = projectsById.get(projectId);
      const actorRole = membershipsByProjectId.get(projectId)?.get(actorUserId);

      if (!project || project.tombstoneAt) {
        throw new ProjectNotFoundError();
      }

      if (!actorRole) {
        throw new ProjectNotFoundError();
      }

      if (actorRole !== "admin") {
        throw new ProjectAdminRequiredError();
      }

      const updatedProject = {
        ...project,
        name,
        updatedAt: new Date(project.updatedAt.getTime() + 1),
      };
      projectsById.set(projectId, updatedProject);

      return updatedProject;
    },
    softDelete: async ({ projectId, actorUserId, deletedAt }) => {
      const project = projectsById.get(projectId);
      const actorRole = membershipsByProjectId.get(projectId)?.get(actorUserId);

      if (!project || project.tombstoneAt) {
        throw new ProjectNotFoundError();
      }

      if (!actorRole) {
        throw new ProjectNotFoundError();
      }

      if (actorRole !== "admin") {
        throw new ProjectAdminRequiredError();
      }

      projectsById.set(projectId, {
        ...project,
        tombstoneAt: deletedAt,
        updatedAt: deletedAt,
      });

      return;
    },
    touchUpdatedAt: async () => {},
  };
}

function createStubCommentService(): CommentService {
  return {
    listThreads: async () => [],
    createThread: async () => {
      throw new Error("Not implemented for createTestApp");
    },
    replyToThread: async () => {
      throw new Error("Not implemented for createTestApp");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for createTestApp");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for createTestApp");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for createTestApp");
    },
  };
}

function createInMemoryDocumentRepository(): DocumentRepository {
  const documentsByProjectId = new Map<string, StoredDocument[]>();
  let nextDocumentId = 1;

  return {
    listForProject: async (projectId) =>
      documentsByProjectId.get(projectId) ?? [],
    findById: async (projectId, documentId) =>
      (documentsByProjectId.get(projectId) ?? []).find(
        (document) => document.id === documentId,
      ) ?? null,
    findByPath: async (projectId, path) =>
      (documentsByProjectId.get(projectId) ?? []).find(
        (document) => document.path === path,
      ) ?? null,
    createDocument: async ({ projectId, path, kind, mime }) => {
      const now = new Date();
      const document: StoredDocument = {
        id: `document-${nextDocumentId}`,
        projectId,
        path,
        kind,
        mime,
        contentHash: null,
        createdAt: now,
        updatedAt: now,
      };
      nextDocumentId += 1;
      documentsByProjectId.set(projectId, [
        ...(documentsByProjectId.get(projectId) ?? []),
        document,
      ]);

      return document;
    },
    moveNode: async ({ projectId, path, nextPath }) => {
      const documents = documentsByProjectId.get(projectId) ?? [];
      const exactDocument = documents.find(
        (document) => document.path === path,
      );

      if (exactDocument) {
        documentsByProjectId.set(
          projectId,
          documents.map((document) =>
            document.id === exactDocument.id
              ? {
                  ...document,
                  path: nextPath,
                  updatedAt: new Date(),
                }
              : document,
          ),
        );

        return true;
      }

      const descendantPrefix = `${path}/`;
      const descendants = documents.filter((document) =>
        document.path.startsWith(descendantPrefix),
      );

      if (descendants.length === 0) {
        return false;
      }

      documentsByProjectId.set(
        projectId,
        documents.map((document) => {
          if (!document.path.startsWith(descendantPrefix)) {
            return document;
          }

          return {
            ...document,
            path: `${nextPath}${document.path.slice(path.length)}`,
            updatedAt: new Date(),
          };
        }),
      );

      return true;
    },
    deleteNode: async ({ projectId, path }) => {
      const documents = documentsByProjectId.get(projectId) ?? [];
      const exactDocument = documents.find(
        (document) => document.path === path,
      );

      if (exactDocument) {
        documentsByProjectId.set(
          projectId,
          documents.filter((document) => document.path !== path),
        );

        return [exactDocument];
      }

      const descendantPrefix = `${path}/`;
      const deletedDocuments = documents.filter((document) =>
        document.path.startsWith(descendantPrefix),
      );

      if (deletedDocuments.length === 0) {
        return [];
      }

      documentsByProjectId.set(
        projectId,
        documents.filter(
          (document) => !document.path.startsWith(descendantPrefix),
        ),
      );
      return deletedDocuments;
    },
  };
}

function createInMemorySnapshotService(): SnapshotService {
  const contentsByDocumentId = new Map<string, string | null>();
  const snapshots = new Map<
    string,
    Array<{
      id: string;
      projectId: string;
      storagePath: string;
      message: string | null;
      authorId: string | null;
      createdAt: Date;
    }>
  >();

  return {
    loadDocumentContent: async (document) => {
      if (!contentsByDocumentId.has(document.id)) {
        return document.kind === "text" ? "" : null;
      }

      return contentsByDocumentId.get(document.id) ?? null;
    },
    captureProjectSnapshot: async ({ projectId, authorId, documents }) => {
      const activeDocumentIds = new Set(
        documents.map((document) => document.id),
      );

      for (const document of documents) {
        if (!contentsByDocumentId.has(document.id)) {
          contentsByDocumentId.set(
            document.id,
            document.kind === "text" ? "" : null,
          );
        }
      }

      for (const documentId of [...contentsByDocumentId.keys()]) {
        if (!activeDocumentIds.has(documentId)) {
          contentsByDocumentId.delete(documentId);
        }
      }

      const snapshot = {
        id: `snapshot-${projectId}`,
        projectId,
        storagePath: `${projectId}/snapshot.json`,
        message: null,
        authorId,
        createdAt: new Date(),
      };

      snapshots.set(projectId, [snapshot]);

      return snapshot;
    },
    listProjectSnapshots: async (projectId) => snapshots.get(projectId) ?? [],
    restoreProjectSnapshot: async ({ projectId }) => {
      const snapshot = snapshots.get(projectId)?.[0];

      if (!snapshot) {
        throw new Error("Not implemented for createTestApp");
      }

      return snapshot;
    },
  };
}

export function createStubBinaryContentService(): BinaryContentService {
  return {
    uploadContent: async () => {
      throw new Error("Not implemented for createTestApp");
    },
    downloadContent: async () => {
      throw new Error("Not implemented for createTestApp");
    },
    createBinaryFile: async () => {
      throw new Error("Not implemented for createTestApp");
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for createTestApp");
    },
  };
}

function createNoopSnapshotRefreshTrigger(): SnapshotRefreshTrigger {
  return {
    kick: () => {},
    stop: () => {},
  };
}
