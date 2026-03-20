import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHttpApp } from "../app.js";
import type { AppConfig } from "../../config/appConfig.js";
import {
  createAuthService,
  DuplicateEmailError,
  signToken,
  type AuthUserRepository,
} from "../../services/auth.js";
import {
  createProjectService,
  InvalidMainDocumentError,
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  ProjectOwnerNotFoundError,
  type ProjectRepository,
} from "../../services/project.js";
import type { StoredDocument } from "../../services/document.js";
import type { AuthService } from "../../services/auth.js";
import type { CommentService } from "../../services/commentService.js";
import type { DocumentService } from "../../services/document.js";
import type { MembershipService } from "../../services/membership.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
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

describe("project routes", () => {
  it("creates a project and lists it with admin role for the creator", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");

    const createResponse = await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "  Thesis  " })
      .expect(201);

    expect(createResponse.body).toEqual({
      project: {
        id: expect.any(String),
        name: "Thesis",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });

    const listResponse = await request(app)
      .get("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .expect(200);

    expect(listResponse.body).toEqual({
      projects: [
        {
          id: createResponse.body.project.id,
          name: "Thesis",
          myRole: "admin",
          updatedAt: createResponse.body.project.updatedAt,
        },
      ],
    });
  });

  it("only lists projects for the authenticated member", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");

    await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Alice Project" })
      .expect(201);

    await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${bob.token}`)
      .send({ name: "Bob Project" })
      .expect(201);

    await expectProjectNames(app, alice.token, ["Alice Project"]);
    await expectProjectNames(app, bob.token, ["Bob Project"]);
  });

  it("returns 404 when a non-member requests project details", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const createResponse = await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Private Project" })
      .expect(201);

    const response = await request(app)
      .get(`/api/projects/${createResponse.body.project.id}`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(404);

    expect(response.body).toEqual({ error: "project not found" });
  });

  it("trims surrounding whitespace from project route params", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const createResponse = await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Whitespace Project" })
      .expect(201);

    const response = await request(app)
      .get(`/api/projects/%20${createResponse.body.project.id}%20`)
      .set("authorization", `Bearer ${alice.token}`)
      .expect(200);

    expect(response.body).toEqual({
      project: {
        id: createResponse.body.project.id,
        name: "Whitespace Project",
        createdAt: createResponse.body.project.createdAt,
        updatedAt: createResponse.body.project.updatedAt,
      },
      myRole: "admin",
    });
  });

  it("rejects project creation without auth", async () => {
    const { app } = createProjectTestApp();

    const response = await request(app)
      .post("/api/projects")
      .send({ name: "No Auth" })
      .expect(401);

    expect(response.body).toEqual({ error: "missing token" });
  });

  it("rejects project requests when the token user no longer exists", async () => {
    const { app } = createProjectTestApp();
    const token = signToken("missing-user-id", testConfig.jwtSecret);

    await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Should Fail" })
      .expect(401)
      .expect({ error: "invalid token" });
  });

  it("rejects invalid project bodies", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");

    await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send([])
      .expect(400)
      .expect({ error: "request body must be an object" });

    await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "   " })
      .expect(400)
      .expect({ error: "name is required" });

    await request(app)
      .patch("/api/projects/project-1")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "a".repeat(161) })
      .expect(400)
      .expect({ error: "name must be at most 160 characters" });

    await request(app)
      .get("/api/projects/%20%20")
      .set("authorization", `Bearer ${alice.token}`)
      .expect(400)
      .expect({ error: "projectId is required" });
  });

  it("rejects malformed project IDs on detail, rename, and delete routes", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");

    await request(app)
      .get("/api/projects/not-a-uuid")
      .set("authorization", `Bearer ${alice.token}`)
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });

    await request(app)
      .patch("/api/projects/not-a-uuid")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Renamed" })
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });

    await request(app)
      .delete("/api/projects/not-a-uuid")
      .set("authorization", `Bearer ${alice.token}`)
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });
  });

  it("allows admins to read, rename, and soft delete projects", async () => {
    const { app } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const createResponse = await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Initial Name" })
      .expect(201);
    const projectId = createResponse.body.project.id as string;

    const detailResponse = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("authorization", `Bearer ${alice.token}`)
      .expect(200);

    expect(detailResponse.body).toEqual({
      project: {
        id: projectId,
        name: "Initial Name",
        createdAt: createResponse.body.project.createdAt,
        updatedAt: createResponse.body.project.updatedAt,
      },
      myRole: "admin",
    });

    const patchResponse = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Renamed Project" })
      .expect(200);

    expect(patchResponse.body).toEqual({
      project: {
        id: projectId,
        name: "Renamed Project",
        createdAt: createResponse.body.project.createdAt,
        updatedAt: expect.any(String),
      },
    });

    await request(app)
      .delete(`/api/projects/${projectId}`)
      .set("authorization", `Bearer ${alice.token}`)
      .expect(204);

    await request(app)
      .get(`/api/projects/${projectId}`)
      .set("authorization", `Bearer ${alice.token}`)
      .expect(404)
      .expect({ error: "project not found" });

    await expectProjectNames(app, alice.token, []);
  });

  it("returns 403 when a non-admin member tries to rename or delete", async () => {
    const { app, addMembership } = createProjectTestApp();
    const alice = await registerUser(app, "alice@example.com", "Alice");
    const bob = await registerUser(app, "bob@example.com", "Bob");
    const createResponse = await request(app)
      .post("/api/projects")
      .set("authorization", `Bearer ${alice.token}`)
      .send({ name: "Team Project" })
      .expect(201);
    const projectId = createResponse.body.project.id as string;

    addMembership(projectId, bob.user.id, "editor");

    await request(app)
      .patch(`/api/projects/${projectId}`)
      .set("authorization", `Bearer ${bob.token}`)
      .send({ name: "Bob Rename" })
      .expect(403)
      .expect({ error: "admin role required" });

    await request(app)
      .delete(`/api/projects/${projectId}`)
      .set("authorization", `Bearer ${bob.token}`)
      .expect(403)
      .expect({ error: "admin role required" });
  });

  it("maps ProjectRoleRequiredError to 403 for future project role checks", async () => {
    const app = createRoleRequiredProjectApp();
    const token = signToken(randomUUID(), testConfig.jwtSecret);

    await request(app)
      .patch(`/api/projects/${randomUUID()}`)
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Renamed" })
      .expect(403)
      .expect({ error: "required project role missing" });
  });

  describe("main document routes", () => {
    it("GET returns null when no main document and no /main.tex", async () => {
      const { app } = createProjectTestApp();
      const alice = await registerUser(app, "alice@example.com", "Alice");
      const createResponse = await request(app)
        .post("/api/projects")
        .set("authorization", `Bearer ${alice.token}`)
        .send({ name: "Empty Project" })
        .expect(201);
      const projectId = createResponse.body.project.id as string;

      const response = await request(app)
        .get(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(200);

      expect(response.body).toEqual({ mainDocument: null });
    });

    it("GET returns /main.tex fallback when no explicit main document set", async () => {
      const { app, addDocument } = createProjectTestApp();
      const alice = await registerUser(app, "alice@example.com", "Alice");
      const createResponse = await request(app)
        .post("/api/projects")
        .set("authorization", `Bearer ${alice.token}`)
        .send({ name: "Thesis" })
        .expect(201);
      const projectId = createResponse.body.project.id as string;
      const docId = randomUUID();
      addDocument(projectId, {
        id: docId,
        path: "/main.tex",
        kind: "text",
        mime: "application/x-tex",
      });

      const response = await request(app)
        .get(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(200);

      expect(response.body.mainDocument).toEqual(
        expect.objectContaining({
          id: docId,
          path: "/main.tex",
          kind: "text",
        }),
      );
    });

    it("PUT sets main document successfully for admin", async () => {
      const { app, addDocument } = createProjectTestApp();
      const alice = await registerUser(app, "alice@example.com", "Alice");
      const createResponse = await request(app)
        .post("/api/projects")
        .set("authorization", `Bearer ${alice.token}`)
        .send({ name: "Thesis" })
        .expect(201);
      const projectId = createResponse.body.project.id as string;
      const docId = randomUUID();
      addDocument(projectId, {
        id: docId,
        path: "/intro.tex",
        kind: "text",
        mime: "application/x-tex",
      });

      await request(app)
        .put(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ documentId: docId })
        .expect(204);

      const response = await request(app)
        .get(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(200);

      expect(response.body.mainDocument).toEqual(
        expect.objectContaining({
          id: docId,
          path: "/intro.tex",
        }),
      );
    });

    it("PUT rejects non-admin/editor with 403", async () => {
      const { app, addMembership } = createProjectTestApp();
      const alice = await registerUser(app, "alice@example.com", "Alice");
      const bob = await registerUser(app, "bob@example.com", "Bob");
      const createResponse = await request(app)
        .post("/api/projects")
        .set("authorization", `Bearer ${alice.token}`)
        .send({ name: "Thesis" })
        .expect(201);
      const projectId = createResponse.body.project.id as string;
      addMembership(projectId, bob.user.id, "reader");

      await request(app)
        .put(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${bob.token}`)
        .send({ documentId: randomUUID() })
        .expect(403);
    });

    it("PUT rejects invalid documentId with 400", async () => {
      const { app } = createProjectTestApp();
      const alice = await registerUser(app, "alice@example.com", "Alice");
      const createResponse = await request(app)
        .post("/api/projects")
        .set("authorization", `Bearer ${alice.token}`)
        .send({ name: "Thesis" })
        .expect(201);
      const projectId = createResponse.body.project.id as string;

      await request(app)
        .put(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ documentId: "not-a-uuid" })
        .expect(400)
        .expect({ error: "documentId must be a valid UUID" });
    });

    it("PUT rejects non-existent document with 400", async () => {
      const { app } = createProjectTestApp();
      const alice = await registerUser(app, "alice@example.com", "Alice");
      const createResponse = await request(app)
        .post("/api/projects")
        .set("authorization", `Bearer ${alice.token}`)
        .send({ name: "Thesis" })
        .expect(201);
      const projectId = createResponse.body.project.id as string;

      await request(app)
        .put(`/api/projects/${projectId}/main-document`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ documentId: randomUUID() })
        .expect(400);
    });
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

async function expectProjectNames(
  app: ReturnType<typeof createHttpApp>,
  token: string,
  names: string[],
) {
  const response = await request(app)
    .get("/api/projects")
    .set("authorization", `Bearer ${token}`)
    .expect(200);

  expect(
    response.body.projects.map((project: { name: string }) => project.name),
  ).toEqual(names);
}

function createProjectTestApp() {
  const { userRepository, hasUser } = createInMemoryUserRepository();
  const documentLookup = createInMemoryDocumentLookup();
  const projectRepository = createInMemoryProjectRepository(
    hasUser,
    documentLookup,
  );
  const app = createHttpApp(testConfig, {
    authService: createAuthService({
      userRepository,
      passwordHasher: createTestPasswordHasher(),
      jwtSecret: testConfig.jwtSecret,
      dummyPasswordHash: TEST_DUMMY_PASSWORD_HASH,
    }),
    commentService: createStubCommentService(),
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
    projectService: createProjectService({
      projectRepository,
      documentLookup,
    }),
    snapshotManagementService: createStubSnapshotManagementService(),
  });

  return {
    app,
    addMembership: projectRepository.addMembership,
    addDocument: documentLookup.addDocument,
  };
}

function createRoleRequiredProjectApp() {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    commentService: createStubCommentService(),
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
    projectService: {
      createProject: async () => {
        throw new Error("Not implemented for role-required route test");
      },
      listProjects: async () => [],
      getProject: async () => {
        throw new Error("Not implemented for role-required route test");
      },
      updateProject: async () => {
        throw new ProjectRoleRequiredError(["editor", "admin"]);
      },
      deleteProject: async () => {
        throw new Error("Not implemented for role-required route test");
      },
      getMainDocument: async () => {
        throw new Error("Not implemented for role-required route test");
      },
      setMainDocument: async () => {
        throw new Error("Not implemented for role-required route test");
      },
    },
    snapshotManagementService: createStubSnapshotManagementService(),
  });
}

function createStubCommentService(): CommentService {
  return {
    listThreads: async () => [],
    createThread: async () => {
      throw new Error("Not implemented for project route tests");
    },
    replyToThread: async () => {
      throw new Error("Not implemented for project route tests");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for project route tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for project route tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for project route tests");
    },
  };
}

function createStubDocumentService(): DocumentService {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("Not implemented for project route tests");
    },
    moveNode: async () => {
      throw new Error("Not implemented for project route tests");
    },
    renameNode: async () => {
      throw new Error("Not implemented for project route tests");
    },
    deleteNode: async () => {
      throw new Error("Not implemented for project route tests");
    },
    getFileContent: async () => {
      throw new Error("Not implemented for project route tests");
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for project route tests");
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

function createInMemoryUserRepository(): {
  userRepository: AuthUserRepository;
  hasUser: (userId: string) => boolean;
} {
  const usersById = new Map<
    string,
    { id: string; email: string; name: string; passwordHash: string }
  >();
  let nextId = 1;

  return {
    userRepository: {
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
    },
    hasUser: (userId) => usersById.has(userId),
  };
}

function createInMemoryDocumentLookup() {
  const documentsByProject = new Map<string, StoredDocument[]>();

  return {
    findById: async (projectId: string, documentId: string) => {
      const docs = documentsByProject.get(projectId) ?? [];
      return docs.find((d) => d.id === documentId) ?? null;
    },
    findByPath: async (projectId: string, path: string) => {
      const docs = documentsByProject.get(projectId) ?? [];
      return docs.find((d) => d.path === path) ?? null;
    },
    addDocument: (
      projectId: string,
      doc: {
        id: string;
        path: string;
        kind: "text" | "binary";
        mime: string | null;
      },
    ) => {
      const now = new Date();
      const stored: StoredDocument = {
        id: doc.id,
        projectId,
        path: doc.path,
        kind: doc.kind,
        mime: doc.mime,
        contentHash: null,
        createdAt: now,
        updatedAt: now,
      };
      const docs = documentsByProject.get(projectId) ?? [];
      docs.push(stored);
      documentsByProject.set(projectId, docs);
    },
  };
}

function createInMemoryProjectRepository(
  hasUser: (userId: string) => boolean,
  documentLookup?: ReturnType<typeof createInMemoryDocumentLookup>,
): ProjectRepository & {
  addMembership: (
    projectId: string,
    userId: string,
    role: "admin" | "editor" | "commenter" | "reader",
  ) => void;
} {
  const projectsById = new Map<
    string,
    {
      id: string;
      name: string;
      createdAt: Date;
      updatedAt: Date;
      tombstoneAt: Date | null;
      mainDocumentId: string | null;
    }
  >();
  const membershipsByProjectId = new Map<
    string,
    Map<string, "admin" | "editor" | "commenter" | "reader">
  >();
  return {
    createForOwner: async ({ ownerUserId, name }) => {
      if (!hasUser(ownerUserId)) {
        throw new ProjectOwnerNotFoundError();
      }

      const now = new Date();
      const project = {
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        tombstoneAt: null,
        mainDocumentId: null,
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
        myRole: membershipsByProjectId.get(project.id)?.get(userId) ?? "reader",
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
    getMainDocumentId: async (projectId) => {
      const project = projectsById.get(projectId);
      if (!project || project.tombstoneAt) return null;
      return project.mainDocumentId;
    },
    setMainDocumentId: async ({ projectId, actorUserId, documentId }) => {
      const project = projectsById.get(projectId);
      if (!project || project.tombstoneAt) {
        throw new ProjectNotFoundError();
      }

      const actorRole = membershipsByProjectId.get(projectId)?.get(actorUserId);
      if (!actorRole) {
        throw new ProjectNotFoundError();
      }

      if (actorRole !== "admin" && actorRole !== "editor") {
        throw new ProjectRoleRequiredError(["admin", "editor"]);
      }

      if (documentLookup) {
        const doc = await documentLookup.findById(projectId, documentId);
        if (!doc) {
          throw new InvalidMainDocumentError("document not found in project");
        }
        if (doc.kind !== "text") {
          throw new InvalidMainDocumentError(
            "main document must be a text file",
          );
        }
      }

      projectsById.set(projectId, {
        ...project,
        mainDocumentId: documentId,
      });
    },
    addMembership: (projectId, userId, role) => {
      const memberships = membershipsByProjectId.get(projectId);

      if (!memberships) {
        throw new Error(`Unknown project ${projectId}`);
      }

      memberships.set(userId, role);
    },
  };
}
