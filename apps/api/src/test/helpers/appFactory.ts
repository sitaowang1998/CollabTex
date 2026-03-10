import { createHttpApp } from "../../http/app.js";
import type { AppConfig } from "../../config/appConfig.js";
import {
  createAuthService,
  DuplicateEmailError,
  type AuthUserRepository,
} from "../../services/auth.js";
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
  const membershipService = createStubMembershipService();

  return createHttpApp(testConfig, {
    authService,
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
