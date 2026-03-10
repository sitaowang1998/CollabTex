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
import type { MembershipService } from "../../services/membership.js";
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
  });
  const membershipService = createStubMembershipService();

  return createHttpApp(testConfig, {
    authService,
    documentService,
    membershipService,
    projectService,
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
    ensureFolderCreatable: async () => {},
    moveNode: async ({ projectId, path, nextPath }) => {
      const documents = documentsByProjectId.get(projectId) ?? [];
      const documentIndex = documents.findIndex(
        (document) => document.path === path,
      );

      if (documentIndex === -1) {
        return false;
      }

      documents[documentIndex] = {
        ...documents[documentIndex],
        path: nextPath,
        updatedAt: new Date(),
      };
      return true;
    },
    deleteNode: async ({ projectId, path }) => {
      const documents = documentsByProjectId.get(projectId) ?? [];
      const nextDocuments = documents.filter(
        (document) => document.path !== path,
      );

      if (nextDocuments.length === documents.length) {
        return false;
      }

      documentsByProjectId.set(projectId, nextDocuments);
      return true;
    },
  };
}
