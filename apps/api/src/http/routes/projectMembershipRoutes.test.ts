import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ProjectRole } from "@collab-tex/shared";
import { createHttpApp } from "../app.js";
import type { AppConfig } from "../../config/appConfig.js";
import {
  createAuthService,
  DuplicateEmailError,
  type AuthUserRepository,
} from "../../services/auth.js";
import type { DocumentService } from "../../services/document.js";
import {
  createMembershipService,
  DuplicateProjectMembershipError,
  LastProjectAdminRemovalError,
  MembershipUserNotFoundError,
  ProjectAdminOrSelfRequiredError,
  type MembershipRepository,
} from "../../services/membership.js";
import { createProjectAccessService } from "../../services/projectAccess.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  createProjectService,
  ProjectOwnerNotFoundError,
  type ProjectRepository,
} from "../../services/project.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
import { signToken, type AuthService } from "../../services/auth.js";
import {
  createTestPasswordHasher,
  TEST_DUMMY_PASSWORD_HASH,
} from "../../test/helpers/passwordHasher.js";

const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 0,
  jwtSecret: "test_secret",
  clientOrigin: "http://localhost:5173",
  databaseUrl:
    "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public",
  snapshotStorageRoot: "/tmp/collabtex-test-snapshots",
};

describe("project membership routes", () => {
  it("lists members for any project member", async () => {
    const { app, addMembership } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const projectId = await createProject(app, alice.token, "Team Project");

    addMembership(projectId, bob.user.id, "reader");

    const response = await request(app)
      .get(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(200);

    expect(response.body).toEqual({
      members: [
        {
          userId: alice.user.id,
          email: "alice@example.com",
          name: "Alice",
          role: "admin",
        },
        {
          userId: bob.user.id,
          email: "bob@example.com",
          name: "Bob",
          role: "reader",
        },
      ],
    });
  });

  it("allows admins to add and update project members", async () => {
    const { app } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const projectId = await createProject(app, alice.token, "Team Project");

    const createResponse = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: " BOB@example.com ", role: "reader" })
      .expect(201);

    expect(createResponse.body).toEqual({
      member: {
        userId: bob.user.id,
        email: "bob@example.com",
        name: "Bob",
        role: "reader",
      },
    });

    const patchResponse = await request(app)
      .patch(`/api/projects/${projectId}/members/${bob.user.id}`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ role: "editor" })
      .expect(200);

    expect(patchResponse.body).toEqual({
      member: {
        userId: bob.user.id,
        email: "bob@example.com",
        name: "Bob",
        role: "editor",
      },
    });
  });

  it("returns 404 when a non-member lists project members", async () => {
    const { app } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const projectId = await createProject(app, alice.token, "Private Project");

    await request(app)
      .get(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(404)
      .expect({ error: "project not found" });
  });

  it("returns 403 when a non-admin member tries to add or update members", async () => {
    const { app, addMembership } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const charlie = await registerUser(app, "charlie@example.com", "Charlie");
    const projectId = await createProject(app, alice.token, "Team Project");

    addMembership(projectId, bob.user.id, "reader");

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${bob.token}`)
      .send({ email: charlie.user.email, role: "reader" })
      .expect(403)
      .expect({ error: "admin role required" });

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${bob.token}`)
      .send({ email: "missing@example.com", role: "reader" })
      .expect(403)
      .expect({ error: "admin role required" });

    await request(app)
      .patch(`/api/projects/${projectId}/members/${alice.user.id}`)
      .set("authorization", `Bearer ${bob.token}`)
      .send({ role: "editor" })
      .expect(403)
      .expect({ error: "admin role required" });
  });

  it("rejects duplicate memberships and missing users", async () => {
    const { app } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const projectId = await createProject(app, alice.token, "Team Project");

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: bob.user.email, role: "reader" })
      .expect(201);

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: bob.user.email, role: "editor" })
      .expect(409)
      .expect({ error: "project membership already exists" });

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: "missing@example.com", role: "reader" })
      .expect(404)
      .expect({ error: "user not found" });
  });

  it("allows self-removal but blocks non-admin removal of others", async () => {
    const { app, addMembership } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const charlie = await registerUser(app, "charlie@example.com", "Charlie");
    const projectId = await createProject(app, alice.token, "Team Project");

    addMembership(projectId, bob.user.id, "reader");
    addMembership(projectId, charlie.user.id, "reader");

    await request(app)
      .delete(`/api/projects/${projectId}/members/${charlie.user.id}`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(403)
      .expect({ error: "admin role or self removal required" });

    await request(app)
      .delete(`/api/projects/${projectId}/members/${bob.user.id}`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(204);

    await request(app)
      .get(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(404)
      .expect({ error: "project not found" });
  });

  it("prevents removing or demoting the last admin", async () => {
    const { app } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const projectId = await createProject(app, alice.token, "Solo Project");

    await request(app)
      .patch(`/api/projects/${projectId}/members/${alice.user.id}`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ role: "editor" })
      .expect(409)
      .expect({ error: "cannot remove the last admin" });

    await request(app)
      .delete(`/api/projects/${projectId}/members/${alice.user.id}`)
      .set("authorization", `Bearer ${alice.token}`)
      .expect(409)
      .expect({ error: "cannot remove the last admin" });
  });

  it("validates request bodies and params", async () => {
    const { app } = createMembershipTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const projectId = await createProject(
      app,
      alice.token,
      "Validation Project",
    );

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send([])
      .expect(400)
      .expect({ error: "request body must be an object" });

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: "   ", role: "reader" })
      .expect(400)
      .expect({ error: "email is required" });

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: "not-an-email", role: "reader" })
      .expect(400)
      .expect({ error: "email must be a valid email address" });

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: `${"a".repeat(321)}@example.com`, role: "reader" })
      .expect(400)
      .expect({ error: "email must be at most 320 characters" });

    await request(app)
      .post(`/api/projects/not-a-uuid/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: "bob@example.com", role: "reader" })
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });

    await request(app)
      .get("/api/projects/not-a-uuid/members")
      .set("authorization", `Bearer ${alice.token}`)
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ email: "bob@example.com", role: "owner" })
      .expect(400)
      .expect({
        error: "role must be one of admin, editor, commenter, reader",
      });

    await request(app)
      .patch(`/api/projects/${projectId}/members/not-a-uuid`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ role: "reader" })
      .expect(400)
      .expect({ error: "userId must be a valid UUID" });
  });

  it("maps ProjectRoleRequiredError to 403 for future role-based membership checks", async () => {
    const app = createRoleRequiredMembershipApp();
    const token = signToken(randomUUID(), testConfig.jwtSecret);

    await request(app)
      .post(`/api/projects/${randomUUID()}/members`)
      .set("authorization", `Bearer ${token}`)
      .send({ email: "bob@example.com", role: "reader" })
      .expect(403)
      .expect({ error: "required project role missing" });
  });
});

async function registerUser(
  app: ReturnType<typeof createHttpApp>,
  email: string,
  name: string,
) {
  const response = await request(app)
    .post("/api/auth/register")
    .send({
      email,
      name,
      password: "secret",
    })
    .expect(201);

  return {
    token: response.body.token as string,
    user: response.body.user as {
      id: string;
      email: string;
      name: string;
    },
  };
}

async function createProject(
  app: ReturnType<typeof createHttpApp>,
  token: string,
  name: string,
) {
  const response = await request(app)
    .post("/api/projects")
    .set("authorization", `Bearer ${token}`)
    .send({ name })
    .expect(201);

  return response.body.project.id as string;
}

function createMembershipTestApp() {
  const usersById = new Map<
    string,
    { id: string; email: string; name: string; passwordHash: string }
  >();
  const usersByEmail = new Map<string, string>();
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
  const membershipsByProjectId = new Map<string, Map<string, ProjectRole>>();

  const userRepository: AuthUserRepository = {
    findByEmail: async (email) => {
      const userId = usersByEmail.get(email);

      return userId ? (usersById.get(userId) ?? null) : null;
    },
    findById: async (id) => usersById.get(id) ?? null,
    create: async ({ email, name, passwordHash }) => {
      if (usersByEmail.has(email)) {
        throw new DuplicateEmailError();
      }

      const user = {
        id: randomUUID(),
        email,
        name,
        passwordHash,
      };

      usersById.set(user.id, user);
      usersByEmail.set(user.email, user.id);

      return user;
    },
  };

  const projectRepository: ProjectRepository = {
    createForOwner: async ({ ownerUserId, name }) => {
      if (!usersById.has(ownerUserId)) {
        throw new ProjectOwnerNotFoundError();
      }

      const now = new Date();
      const project = {
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        tombstoneAt: null,
      };

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
    listForUser: async (userId) =>
      [...projectsById.values()]
        .filter((project) => {
          if (project.tombstoneAt) {
            return false;
          }

          return membershipsByProjectId.get(project.id)?.has(userId) ?? false;
        })
        .map((project) => ({
          project,
          myRole:
            membershipsByProjectId.get(project.id)?.get(userId) ?? "reader",
        })),
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

  const membershipRepository: MembershipRepository = {
    listMembersForUser: async (projectId, actorUserId) => {
      const project = projectsById.get(projectId);

      if (!project || project.tombstoneAt) {
        return null;
      }

      const memberships = membershipsByProjectId.get(projectId);

      if (!memberships || !memberships.has(actorUserId)) {
        return null;
      }

      return [...memberships.entries()].map(([userId, role]) => {
        const user = usersById.get(userId);

        if (!user) {
          throw new Error(`Unknown user ${userId}`);
        }

        return {
          userId,
          email: user.email,
          name: user.name,
          role,
        };
      });
    },
    createMembership: async ({ projectId, actorUserId, userId, role }) => {
      const project = projectsById.get(projectId);

      if (!project || project.tombstoneAt) {
        throw new ProjectNotFoundError();
      }

      const user = usersById.get(userId);

      if (!user) {
        throw new MembershipUserNotFoundError();
      }

      const memberships = membershipsByProjectId.get(projectId);

      if (!memberships) {
        throw new ProjectNotFoundError();
      }

      const actorRole = memberships.get(actorUserId);

      if (!actorRole) {
        throw new ProjectNotFoundError();
      }

      if (actorRole !== "admin") {
        throw new ProjectAdminRequiredError();
      }

      if (memberships.has(userId)) {
        throw new DuplicateProjectMembershipError();
      }

      memberships.set(userId, role);

      return {
        userId,
        email: user.email,
        name: user.name,
        role,
      };
    },
    updateMembershipRole: async ({ projectId, actorUserId, userId, role }) => {
      const project = projectsById.get(projectId);

      if (!project || project.tombstoneAt) {
        throw new ProjectNotFoundError();
      }

      const memberships = membershipsByProjectId.get(projectId);
      const user = usersById.get(userId);
      const actorRole = memberships?.get(actorUserId);

      if (!memberships || !actorRole) {
        throw new ProjectNotFoundError();
      }

      if (actorRole !== "admin") {
        throw new ProjectAdminRequiredError();
      }

      if (!memberships?.has(userId) || !user) {
        return null;
      }

      if (memberships.get(userId) === "admin" && role !== "admin") {
        const adminCount = [...memberships.values()].filter(
          (memberRole) => memberRole === "admin",
        ).length;

        if (adminCount <= 1) {
          throw new LastProjectAdminRemovalError();
        }
      }

      memberships.set(userId, role);

      return {
        userId,
        email: user.email,
        name: user.name,
        role,
      };
    },
    deleteMembership: async ({ projectId, actorUserId, userId }) => {
      const project = projectsById.get(projectId);

      if (!project || project.tombstoneAt) {
        throw new ProjectNotFoundError();
      }

      const memberships = membershipsByProjectId.get(projectId);
      const actorRole = memberships?.get(actorUserId);

      if (!memberships || !actorRole) {
        throw new ProjectNotFoundError();
      }

      if (actorRole !== "admin" && actorUserId !== userId) {
        throw new ProjectAdminOrSelfRequiredError();
      }

      if (!memberships?.has(userId)) {
        return false;
      }

      if (memberships.get(userId) === "admin") {
        const adminCount = [...memberships.values()].filter(
          (memberRole) => memberRole === "admin",
        ).length;

        if (adminCount <= 1) {
          throw new LastProjectAdminRemovalError();
        }
      }

      return memberships?.delete(userId) ?? false;
    },
  };

  const projectAccessService = createProjectAccessService({
    projectRepository,
  });
  const app = createHttpApp(testConfig, {
    authService: createAuthService({
      userRepository,
      passwordHasher: createTestPasswordHasher(),
      jwtSecret: testConfig.jwtSecret,
      dummyPasswordHash: TEST_DUMMY_PASSWORD_HASH,
    }),
    documentService: createStubDocumentService(),
    membershipService: createMembershipService({
      membershipRepository,
      userLookup: userRepository,
      projectAccessService,
    }),
    projectService: createProjectService({
      projectRepository,
      projectAccessService,
    }),
    snapshotManagementService: createStubSnapshotManagementService(),
  });

  return {
    app,
    addMembership: (projectId: string, userId: string, role: ProjectRole) => {
      const memberships = membershipsByProjectId.get(projectId);

      if (!memberships) {
        throw new Error(`Unknown project ${projectId}`);
      }

      memberships.set(userId, role);
    },
  };
}

function createRoleRequiredMembershipApp() {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    documentService: createStubDocumentService(),
    membershipService: {
      listMembers: async () => [],
      addMember: async () => {
        throw new ProjectRoleRequiredError(["editor", "admin"]);
      },
      updateMemberRole: async () => {
        throw new Error("Not implemented for role-required route test");
      },
      deleteMember: async () => {
        throw new Error("Not implemented for role-required route test");
      },
    },
    projectService: createStubProjectService(),
    snapshotManagementService: createStubSnapshotManagementService(),
  });
}

function createStubDocumentService(): DocumentService {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("Not implemented for membership route tests");
    },
    moveNode: async () => {
      throw new Error("Not implemented for membership route tests");
    },
    renameNode: async () => {
      throw new Error("Not implemented for membership route tests");
    },
    deleteNode: async () => {
      throw new Error("Not implemented for membership route tests");
    },
    getFileContent: async () => {
      throw new Error("Not implemented for membership route tests");
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for membership route tests");
    },
  };
}

function createStubAuthService(): AuthService {
  return {
    register: async () => {
      throw new Error("Not implemented for role-required route test");
    },
    login: async () => {
      throw new Error("Not implemented for role-required route test");
    },
    getAuthenticatedUser: async () => {
      throw new Error("Not implemented for role-required route test");
    },
  };
}

function createStubProjectService(): ReturnType<typeof createProjectService> {
  return {
    createProject: async () => {
      throw new Error("Not implemented for role-required route test");
    },
    listProjects: async () => [],
    getProject: async () => {
      throw new Error("Not implemented for role-required route test");
    },
    updateProject: async () => {
      throw new Error("Not implemented for role-required route test");
    },
    deleteProject: async () => {
      throw new Error("Not implemented for role-required route test");
    },
  };
}
