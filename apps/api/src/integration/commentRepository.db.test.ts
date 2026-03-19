import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createCommentRepository } from "../repositories/commentRepository.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import {
  CommentAuthorNotFoundError,
  CommentDocumentNotFoundError,
  CommentThreadNotFoundError,
} from "../services/comment.js";
import { ProjectNotFoundError } from "../services/projectAccess.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("comment repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("creates a thread with first comment and reads it back", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-create-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment Create ${suffix}`);
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "line:5:col:0",
      endAnchor: "line:5:col:20",
      quotedText: "\\section{Introduction}",
      authorId: owner.id,
      body: "Should we expand this section?",
    });

    expect(thread).toMatchObject({
      projectId: project.id,
      documentId: document.id,
      status: "open",
      startAnchor: "line:5:col:0",
      endAnchor: "line:5:col:20",
      quotedText: "\\section{Introduction}",
    });
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]).toMatchObject({
      threadId: thread.id,
      authorId: owner.id,
      body: "Should we expand this section?",
    });

    const found = await repository.findThreadById(thread.id);

    expect(found).toMatchObject({
      id: thread.id,
      quotedText: "\\section{Introduction}",
    });
  });

  it("round-trips quotedText with special characters", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-unicode-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment Unicode ${suffix}`);
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const specialText =
      "Ünïcödé «quotes» — em-dash\n\\begin{equation}\n  x^2\n\\end{equation}";

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: specialText,
      authorId: owner.id,
      body: "check this",
    });

    expect(thread.quotedText).toBe(specialText);
  });

  it("lists threads ordered by createdAt", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-list-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment List ${suffix}`);
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread1 = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a1",
      endAnchor: "b1",
      quotedText: "first",
      authorId: owner.id,
      body: "first thread",
    });

    const thread2 = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a2",
      endAnchor: "b2",
      quotedText: "second",
      authorId: owner.id,
      body: "second thread",
    });

    const threads = await repository.listThreadsForDocument({
      projectId: project.id,
      documentId: document.id,
    });

    expect(threads).toHaveLength(2);
    expect(threads[0]!.id).toBe(thread1.id);
    expect(threads[1]!.id).toBe(thread2.id);
  });

  it("lists comments within a thread ordered by createdAt", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-replies-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment Replies ${suffix}`);
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "text",
      authorId: owner.id,
      body: "first comment",
    });

    const reply1 = await repository.addComment({
      threadId: thread.id,
      authorId: owner.id,
      body: "second comment",
    });

    const reply2 = await repository.addComment({
      threadId: thread.id,
      authorId: owner.id,
      body: "third comment",
    });

    const threads = await repository.listThreadsForDocument({
      projectId: project.id,
      documentId: document.id,
    });

    expect(threads).toHaveLength(1);
    expect(threads[0]!.comments).toHaveLength(3);
    expect(threads[0]!.comments[0]!.body).toBe("first comment");
    expect(threads[0]!.comments[1]!.id).toBe(reply1.id);
    expect(threads[0]!.comments[2]!.id).toBe(reply2.id);
  });

  it("scopes threads to specific project and document", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-scope-${suffix}@example.com`);
    const projectA = await createProject(owner.id, `Scope A ${suffix}`);
    const projectB = await createProject(owner.id, `Scope B ${suffix}`);
    const docA1 = await createTextDocument(projectA.id, owner.id, "/a1.tex");
    const docA2 = await createTextDocument(projectA.id, owner.id, "/a2.tex");
    const docB1 = await createTextDocument(projectB.id, owner.id, "/b1.tex");
    const repository = createCommentRepository(getDb());

    await repository.createThread({
      projectId: projectA.id,
      documentId: docA1.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "docA1",
      authorId: owner.id,
      body: "on docA1",
    });

    await repository.createThread({
      projectId: projectA.id,
      documentId: docA2.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "docA2",
      authorId: owner.id,
      body: "on docA2",
    });

    await repository.createThread({
      projectId: projectB.id,
      documentId: docB1.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "docB1",
      authorId: owner.id,
      body: "on docB1",
    });

    const threadsA1 = await repository.listThreadsForDocument({
      projectId: projectA.id,
      documentId: docA1.id,
    });
    const threadsA2 = await repository.listThreadsForDocument({
      projectId: projectA.id,
      documentId: docA2.id,
    });
    const threadsB1 = await repository.listThreadsForDocument({
      projectId: projectB.id,
      documentId: docB1.id,
    });

    expect(threadsA1).toHaveLength(1);
    expect(threadsA1[0]!.quotedText).toBe("docA1");
    expect(threadsA2).toHaveLength(1);
    expect(threadsA2[0]!.quotedText).toBe("docA2");
    expect(threadsB1).toHaveLength(1);
    expect(threadsB1[0]!.quotedText).toBe("docB1");
  });

  it("hides threads for tombstoned projects", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-tombstone-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Comment Tombstone ${suffix}`,
    );
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "text",
      authorId: owner.id,
      body: "comment",
    });

    await getDb().project.update({
      where: { id: project.id },
      data: { tombstoneAt: new Date("2026-03-14T12:00:00.000Z") },
    });

    const threads = await repository.listThreadsForDocument({
      projectId: project.id,
      documentId: document.id,
    });

    expect(threads).toHaveLength(0);

    const found = await repository.findThreadById(thread.id);

    expect(found).toBeNull();
  });

  it("rejects thread creation for missing document", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-no-doc-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment No Doc ${suffix}`);
    const repository = createCommentRepository(getDb());

    await expect(
      repository.createThread({
        projectId: project.id,
        documentId: "00000000-0000-0000-0000-000000000000",
        startAnchor: "a",
        endAnchor: "b",
        quotedText: "text",
        authorId: owner.id,
        body: "comment",
      }),
    ).rejects.toBeInstanceOf(CommentDocumentNotFoundError);
  });

  it("rejects thread creation for tombstoned project", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `comment-tombstone-create-${suffix}@example.com`,
    );
    const project = await createProject(
      owner.id,
      `Comment Tombstone Create ${suffix}`,
    );
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    await getDb().project.update({
      where: { id: project.id },
      data: { tombstoneAt: new Date("2026-03-14T12:00:00.000Z") },
    });

    await expect(
      repository.createThread({
        projectId: project.id,
        documentId: document.id,
        startAnchor: "a",
        endAnchor: "b",
        quotedText: "text",
        authorId: owner.id,
        body: "comment",
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("rejects addComment for tombstoned project", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `comment-tombstone-add-${suffix}@example.com`,
    );
    const project = await createProject(
      owner.id,
      `Comment Tombstone Add ${suffix}`,
    );
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "text",
      authorId: owner.id,
      body: "comment",
    });

    await getDb().project.update({
      where: { id: project.id },
      data: { tombstoneAt: new Date("2026-03-14T12:00:00.000Z") },
    });

    await expect(
      repository.addComment({
        threadId: thread.id,
        authorId: owner.id,
        body: "late comment",
      }),
    ).rejects.toBeInstanceOf(CommentThreadNotFoundError);
  });

  it("rejects addComment for missing thread", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-no-thread-${suffix}@example.com`);
    await createProject(owner.id, `Comment No Thread ${suffix}`);
    const repository = createCommentRepository(getDb());

    await expect(
      repository.addComment({
        threadId: "00000000-0000-0000-0000-000000000000",
        authorId: owner.id,
        body: "orphan comment",
      }),
    ).rejects.toBeInstanceOf(CommentThreadNotFoundError);
  });

  it("cascades thread and comment deletion when document is deleted", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-cascade-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment Cascade ${suffix}`);
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());
    const documentRepository = createDocumentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "text",
      authorId: owner.id,
      body: "comment",
    });

    await repository.addComment({
      threadId: thread.id,
      authorId: owner.id,
      body: "reply",
    });

    await documentRepository.deleteNode({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
    });

    const threads = await repository.listThreadsForDocument({
      projectId: project.id,
      documentId: document.id,
    });

    expect(threads).toHaveLength(0);

    // Also verify at the DB level that rows are gone
    const threadRow = await getDb().commentThread.findUnique({
      where: { id: thread.id },
    });

    expect(threadRow).toBeNull();
  });

  it("returns null for nonexistent thread ID", async () => {
    const repository = createCommentRepository(getDb());

    const found = await repository.findThreadById(
      "00000000-0000-0000-0000-000000000000",
    );

    expect(found).toBeNull();
  });

  it("rejects thread creation with cross-project document mismatch", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-cross-${suffix}@example.com`);
    const projectA = await createProject(owner.id, `Cross A ${suffix}`);
    const projectB = await createProject(owner.id, `Cross B ${suffix}`);
    const docA = await createTextDocument(projectA.id, owner.id, "/main.tex");
    const repository = createCommentRepository(getDb());

    await expect(
      repository.createThread({
        projectId: projectB.id,
        documentId: docA.id,
        startAnchor: "a",
        endAnchor: "b",
        quotedText: "text",
        authorId: owner.id,
        body: "cross-project comment",
      }),
    ).rejects.toBeInstanceOf(CommentDocumentNotFoundError);
  });

  it("rejects createThread with nonexistent author", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-no-author-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Comment No Author ${suffix}`,
    );
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    await expect(
      repository.createThread({
        projectId: project.id,
        documentId: document.id,
        startAnchor: "a",
        endAnchor: "b",
        quotedText: "text",
        authorId: "00000000-0000-0000-0000-000000000000",
        body: "ghost comment",
      }),
    ).rejects.toBeInstanceOf(CommentAuthorNotFoundError);
  });

  it("rejects addComment with nonexistent author", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `comment-add-no-author-${suffix}@example.com`,
    );
    const project = await createProject(
      owner.id,
      `Comment Add No Author ${suffix}`,
    );
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "text",
      authorId: owner.id,
      body: "comment",
    });

    await expect(
      repository.addComment({
        threadId: thread.id,
        authorId: "00000000-0000-0000-0000-000000000000",
        body: "ghost reply",
      }),
    ).rejects.toBeInstanceOf(CommentAuthorNotFoundError);
  });

  it("returns full StoredComment shape from addComment", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-shape-${suffix}@example.com`);
    const project = await createProject(owner.id, `Comment Shape ${suffix}`);
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const thread = await repository.createThread({
      projectId: project.id,
      documentId: document.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "text",
      authorId: owner.id,
      body: "first",
    });

    const reply = await repository.addComment({
      threadId: thread.id,
      authorId: owner.id,
      body: "reply body",
    });

    expect(reply).toMatchObject({
      threadId: thread.id,
      authorId: owner.id,
      body: "reply body",
    });
    expect(reply.id).toEqual(expect.any(String));
    expect(reply.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(reply).sort()).toEqual(
      ["id", "threadId", "authorId", "body", "createdAt"].sort(),
    );
  });

  it("returns empty list for document with no threads", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`comment-empty-list-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Comment Empty List ${suffix}`,
    );
    const document = await createTextDocument(
      project.id,
      owner.id,
      "/main.tex",
    );
    const repository = createCommentRepository(getDb());

    const threads = await repository.listThreadsForDocument({
      projectId: project.id,
      documentId: document.id,
    });

    expect(threads).toEqual([]);
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "User",
      passwordHash: "hash",
    },
  });
}

async function createProject(ownerUserId: string, name: string) {
  return createProjectRepository(getDb()).createForOwner({
    ownerUserId,
    name,
  });
}

async function createTextDocument(
  projectId: string,
  actorUserId: string,
  path: string,
) {
  return createDocumentRepository(getDb()).createDocument({
    projectId,
    actorUserId,
    path,
    kind: "text",
    mime: "text/x-tex",
  });
}
