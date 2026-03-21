import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ProjectRole } from "@collab-tex/shared";
import { createHttpApp } from "../app.js";
import {
  createAuthService,
  DuplicateEmailError,
  signToken,
  type AuthUserRepository,
} from "../../services/auth.js";
import type {
  CommentRepository,
  StoredComment,
  StoredCommentThread,
  StoredCommentThreadWithComments,
} from "../../services/comment.js";
import { CommentDocumentNotFoundError } from "../../services/comment.js";
import { createCommentService } from "../../services/commentService.js";
import type { DocumentService } from "../../services/document.js";
import type { MembershipService } from "../../services/membership.js";
import { createProjectAccessService } from "../../services/projectAccess.js";
import {
  createProjectService,
  type ProjectRepository,
} from "../../services/project.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
import {
  createTestPasswordHasher,
  TEST_DUMMY_PASSWORD_HASH,
} from "../../test/helpers/passwordHasher.js";
import { testConfig } from "../../test/helpers/appFactory.js";

describe("comment routes", () => {
  describe("GET /api/projects/:projectId/docs/:docId/comments", () => {
    it("returns threads with quotedText", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "anchor-start",
          endAnchorB64: "anchor-end",
          quotedText: "selected text",
          body: "first comment",
        })
        .expect(201);

      const response = await request(app)
        .get(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(200);

      expect(response.body.threads).toHaveLength(1);
      expect(response.body.threads[0]).toMatchObject({
        documentId: docId,
        projectId,
        status: "open",
        startAnchor: "anchor-start",
        endAnchor: "anchor-end",
        quotedText: "selected text",
      });
      expect(response.body.threads[0].comments).toHaveLength(1);
      expect(response.body.threads[0].comments[0]).toMatchObject({
        authorId: alice.user.id,
        body: "first comment",
      });
      expect(response.body.threads[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(response.body.threads[0].updatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(response.body.threads[0].comments[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it("returns empty array when no threads exist", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      const response = await request(app)
        .get(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(200);

      expect(response.body).toEqual({ threads: [] });
    });

    it("returns 401 without auth", async () => {
      const { app, projectId, docId } = await setupCommentTestApp();

      await request(app)
        .get(`/api/projects/${projectId}/docs/${docId}/comments`)
        .expect(401);
    });

    it("returns 404 for non-member", async () => {
      const { app, projectId, docId } = await setupCommentTestApp();
      const outsider = signToken(randomUUID(), testConfig.jwtSecret);

      await request(app)
        .get(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${outsider}`)
        .expect(404)
        .expect({ error: "project not found" });
    });
  });

  describe("POST /api/projects/:projectId/docs/:docId/comments", () => {
    it("creates a thread with quotedText (201)", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      const response = await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "anchor-start",
          endAnchorB64: "anchor-end",
          quotedText: "selected text",
          body: "my comment",
        })
        .expect(201);

      expect(response.body.thread).toMatchObject({
        documentId: docId,
        projectId,
        status: "open",
        startAnchor: "anchor-start",
        endAnchor: "anchor-end",
        quotedText: "selected text",
      });
      expect(response.body.thread.comments).toHaveLength(1);
      expect(response.body.thread.comments[0]).toMatchObject({
        authorId: alice.user.id,
        body: "my comment",
      });
    });

    it("returns 400 for missing fields", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ body: "missing anchors" })
        .expect(400)
        .expect({ error: "startAnchorB64 is required" });

      await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
        })
        .expect(400)
        .expect({ error: "body is required" });
    });

    it("returns 401 without auth", async () => {
      const { app, projectId, docId } = await setupCommentTestApp();

      await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
          body: "c",
        })
        .expect(401);
    });

    it("returns 403 for reader role", async () => {
      const { app, projectId, docId, addMembership } =
        await setupCommentTestApp();
      const readerId = randomUUID();
      addMembership(projectId, readerId, "reader");
      const readerToken = signToken(readerId, testConfig.jwtSecret);

      await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${readerToken}`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
          body: "c",
        })
        .expect(403)
        .expect({ error: "required project role missing" });
    });

    it("preserves leading/trailing whitespace in quotedText", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      const response = await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "anchor-start",
          endAnchorB64: "anchor-end",
          quotedText: "  selected text  ",
          body: "my comment",
        })
        .expect(201);

      expect(response.body.thread.quotedText).toBe("  selected text  ");
    });

    it("allows commenter role to create a thread", async () => {
      const { app, projectId, docId, addMembership } =
        await setupCommentTestApp();
      const commenterId = randomUUID();
      addMembership(projectId, commenterId, "commenter");
      const commenterToken = signToken(commenterId, testConfig.jwtSecret);

      await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${commenterToken}`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
          body: "from commenter",
        })
        .expect(201);
    });
  });

  describe("POST /api/projects/:projectId/threads/:threadId/reply", () => {
    it("replies to a thread (201)", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      const createResponse = await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
          body: "initial",
        })
        .expect(201);

      const threadId = createResponse.body.thread.id as string;

      const replyResponse = await request(app)
        .post(`/api/projects/${projectId}/threads/${threadId}/reply`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ body: "reply text" })
        .expect(201);

      expect(replyResponse.body.comment).toMatchObject({
        threadId,
        authorId: alice.user.id,
        body: "reply text",
      });
    });

    it("reply appears in subsequent GET listing", async () => {
      const { app, alice, projectId, docId } = await setupCommentTestApp();

      const createResponse = await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
          body: "initial",
        })
        .expect(201);

      const threadId = createResponse.body.thread.id as string;

      await request(app)
        .post(`/api/projects/${projectId}/threads/${threadId}/reply`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ body: "reply text" })
        .expect(201);

      const listResponse = await request(app)
        .get(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(200);

      expect(listResponse.body.threads).toHaveLength(1);
      expect(listResponse.body.threads[0].comments).toHaveLength(2);
      expect(listResponse.body.threads[0].comments[0].body).toBe("initial");
      expect(listResponse.body.threads[0].comments[1].body).toBe("reply text");
    });

    it("returns 400 for missing body", async () => {
      const { app, alice, projectId } = await setupCommentTestApp();
      const threadId = randomUUID();

      await request(app)
        .post(`/api/projects/${projectId}/threads/${threadId}/reply`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({})
        .expect(400)
        .expect({ error: "body is required" });
    });

    it("returns 401 without auth", async () => {
      const { app, projectId } = await setupCommentTestApp();
      const threadId = randomUUID();

      await request(app)
        .post(`/api/projects/${projectId}/threads/${threadId}/reply`)
        .send({ body: "reply" })
        .expect(401);
    });

    it("returns 404 for missing thread", async () => {
      const { app, alice, projectId } = await setupCommentTestApp();
      const threadId = randomUUID();

      await request(app)
        .post(`/api/projects/${projectId}/threads/${threadId}/reply`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ body: "reply" })
        .expect(404)
        .expect({ error: "comment thread not found" });
    });

    it("returns 403 for reader role", async () => {
      const { app, alice, projectId, docId, addMembership } =
        await setupCommentTestApp();

      const createResponse = await request(app)
        .post(`/api/projects/${projectId}/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({
          startAnchorB64: "a",
          endAnchorB64: "b",
          quotedText: "qt",
          body: "initial",
        })
        .expect(201);

      const threadId = createResponse.body.thread.id as string;
      const readerId = randomUUID();
      addMembership(projectId, readerId, "reader");
      const readerToken = signToken(readerId, testConfig.jwtSecret);

      await request(app)
        .post(`/api/projects/${projectId}/threads/${threadId}/reply`)
        .set("authorization", `Bearer ${readerToken}`)
        .send({ body: "reply" })
        .expect(403)
        .expect({ error: "required project role missing" });
    });
  });

  describe("invalid UUIDs", () => {
    it("returns 400 for malformed projectId", async () => {
      const { app, alice } = await setupCommentTestApp();
      const docId = randomUUID();

      await request(app)
        .get(`/api/projects/not-a-uuid/docs/${docId}/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(400)
        .expect({ error: "projectId must be a valid UUID" });
    });

    it("returns 400 for malformed docId", async () => {
      const { app, alice, projectId } = await setupCommentTestApp();

      await request(app)
        .get(`/api/projects/${projectId}/docs/not-a-uuid/comments`)
        .set("authorization", `Bearer ${alice.token}`)
        .expect(400)
        .expect({ error: "docId must be a valid UUID" });
    });

    it("returns 400 for malformed threadId", async () => {
      const { app, alice, projectId } = await setupCommentTestApp();

      await request(app)
        .post(`/api/projects/${projectId}/threads/not-a-uuid/reply`)
        .set("authorization", `Bearer ${alice.token}`)
        .send({ body: "reply" })
        .expect(400)
        .expect({ error: "threadId must be a valid UUID" });
    });
  });
});

async function setupCommentTestApp() {
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
      const user = { id: randomUUID(), email, name, passwordHash };
      usersById.set(user.id, user);
      usersByEmail.set(user.email, user.id);
      return user;
    },
  };

  const projectRepository: ProjectRepository = {
    createForOwner: async ({ ownerUserId, name }) => {
      const now = new Date();
      const project = {
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        tombstoneAt: null,
      };
      projectsById.set(project.id, project);
      membershipsByProjectId.set(
        project.id,
        new Map([[ownerUserId, "admin" as ProjectRole]]),
      );
      return project;
    },
    findActiveById: async (projectId) => {
      const project = projectsById.get(projectId);
      if (!project || project.tombstoneAt) return null;
      return project;
    },
    listForUser: async () => [],
    findForUser: async (projectId, userId) => {
      const project = projectsById.get(projectId);
      if (!project || project.tombstoneAt) return null;
      const role = membershipsByProjectId.get(projectId)?.get(userId);
      if (!role) return null;
      return { project, myRole: role };
    },
    updateName: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    softDelete: async () => {
      throw new Error("Not implemented for comment route tests");
    },
  };

  const knownDocumentIds = new Set<string>();
  const commentRepository = createInMemoryCommentRepository(knownDocumentIds);

  const projectAccessService = createProjectAccessService({
    projectRepository,
  });

  const authService = createAuthService({
    userRepository,
    passwordHasher: createTestPasswordHasher(),
    jwtSecret: testConfig.jwtSecret,
    dummyPasswordHash: TEST_DUMMY_PASSWORD_HASH,
  });

  const commentService = createCommentService({
    commentRepository,
    projectAccessService,
  });

  const projectService = createProjectService({
    projectRepository,
    projectAccessService,
  });

  const app = createHttpApp(testConfig, {
    authService,
    commentService,
    compileDispatchService: {
      compile: async () => {
        throw new Error("stub");
      },
    },
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
    projectService,
    snapshotManagementService: createStubSnapshotManagementService(),
  });

  const aliceResponse = await request(app)
    .post("/api/auth/register")
    .send({ email: "alice@example.com", name: "Alice", password: "secret" })
    .expect(201);

  const alice = {
    token: aliceResponse.body.token as string,
    user: aliceResponse.body.user as {
      id: string;
      email: string;
      name: string;
    },
  };

  const projectResponse = await request(app)
    .post("/api/projects")
    .set("authorization", `Bearer ${alice.token}`)
    .send({ name: "Comment Project" })
    .expect(201);

  const projectId = projectResponse.body.project.id as string;
  const docId = randomUUID();
  knownDocumentIds.add(docId);

  return {
    app,
    alice,
    projectId,
    docId,
    addMembership: (
      forProjectId: string,
      userId: string,
      role: ProjectRole,
    ) => {
      const memberships = membershipsByProjectId.get(forProjectId);
      if (!memberships) {
        throw new Error(`Unknown project ${forProjectId}`);
      }
      memberships.set(userId, role);
    },
  };
}

function createInMemoryCommentRepository(
  knownDocumentIds: Set<string>,
): CommentRepository {
  const threadsById = new Map<string, StoredCommentThread>();
  const commentsByThreadId = new Map<string, StoredComment[]>();

  return {
    createThread: async (input) => {
      if (!knownDocumentIds.has(input.documentId)) {
        throw new CommentDocumentNotFoundError();
      }
      const threadId = randomUUID();
      const now = new Date();
      const thread: StoredCommentThread = {
        id: threadId,
        projectId: input.projectId,
        documentId: input.documentId,
        status: "open",
        startAnchor: input.startAnchor,
        endAnchor: input.endAnchor,
        quotedText: input.quotedText,
        createdAt: now,
        updatedAt: now,
      };
      threadsById.set(threadId, thread);

      const comment: StoredComment = {
        id: randomUUID(),
        threadId,
        authorId: input.authorId,
        body: input.body,
        createdAt: now,
      };
      commentsByThreadId.set(threadId, [comment]);

      return { ...thread, comments: [comment] };
    },
    listThreadsForDocument: async ({ projectId, documentId }) => {
      const result: StoredCommentThreadWithComments[] = [];
      for (const thread of threadsById.values()) {
        if (
          thread.projectId === projectId &&
          thread.documentId === documentId
        ) {
          result.push({
            ...thread,
            comments: commentsByThreadId.get(thread.id) ?? [],
          });
        }
      }
      return result;
    },
    addComment: async (input) => {
      const comment: StoredComment = {
        id: randomUUID(),
        threadId: input.threadId,
        authorId: input.authorId,
        body: input.body,
        createdAt: new Date(),
      };
      const existing = commentsByThreadId.get(input.threadId) ?? [];
      existing.push(comment);
      commentsByThreadId.set(input.threadId, existing);
      return comment;
    },
    findThreadById: async (threadId) => threadsById.get(threadId) ?? null,
  };
}

function createStubDocumentService(): DocumentService {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    moveNode: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    renameNode: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    deleteNode: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    getFileContent: async () => {
      throw new Error("Not implemented for comment route tests");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for comment route tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for comment route tests");
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for comment route tests");
    },
  };
}
