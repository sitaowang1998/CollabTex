import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
import { createCommentRepository } from "../repositories/commentRepository.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectStateRepository } from "../repositories/projectStateRepository.js";
import { createSnapshotRepository } from "../repositories/snapshotRepository.js";
import { createCollaborationService } from "../services/collaboration.js";
import {
  createSnapshotService,
  InvalidSnapshotDataError,
} from "../services/snapshot.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("snapshot restore integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("restores the historical tree, rewrites text state, and checkpoints the restored state", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-restore-"),
    );
    const owner = await createUser(`snapshot-restore-${suffix}@example.com`);
    const project = await createProject(owner.id, `Snapshot Restore ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const liveMain = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const liveBinary = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/images/live.png",
      kind: "binary",
      mime: "image/png",
    });
    const newerText = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/newer.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const collaborationService = createCollaborationService();

    await textStateRepository.create({
      documentId: liveMain.id,
      ...createStoredTextState(collaborationService, "\\section{Live main}"),
    });
    await textStateRepository.create({
      documentId: newerText.id,
      ...createStoredTextState(collaborationService, "\\section{Newer}"),
    });

    const snapshotState = {
      commentThreads: [],
      documents: {
        [liveMain.id]: {
          path: "/restored/main.tex",
          kind: "text" as const,
          mime: "text/x-tex",
          textContent: "\\section{Restored main}",
        },
        [liveBinary.id]: {
          path: "/figure.png",
          kind: "binary" as const,
          mime: "image/png",
          binaryContentBase64: "AQID",
        },
        "11111111-1111-1111-1111-111111111111": {
          path: "/chapters/old.tex",
          kind: "text" as const,
          mime: "text/x-tex",
          textContent: "\\section{Historical}",
        },
      },
    };
    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const snapshotStoragePath = `${project.id}/target.json`;

    await snapshotStore.writeProjectSnapshot(
      snapshotStoragePath,
      snapshotState,
    );
    const targetSnapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: snapshotStoragePath,
        message: "Historical snapshot",
        authorId: owner.id,
      },
    });
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: createDocumentRepository(getDb()),
      commentThreadLookup: {
        listThreadsForProject: async () => [],
      },
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    const restoredSnapshot = await service.restoreProjectSnapshot({
      projectId: project.id,
      snapshotId: targetSnapshot.id,
      actorUserId: owner.id,
    });

    const restoredDocuments = await getDb().document.findMany({
      where: {
        projectId: project.id,
      },
      orderBy: {
        path: "asc",
      },
    });
    const restoredTextStates = await getDb().documentTextState.findMany({
      where: {
        documentId: {
          in: restoredDocuments.map((document) => document.id),
        },
      },
      orderBy: {
        documentId: "asc",
      },
    });
    const snapshots = await getDb().snapshot.findMany({
      where: {
        projectId: project.id,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
    });
    const checkpointState = await snapshotStore.readProjectSnapshot(
      restoredSnapshot.storagePath,
    );

    expect(
      restoredDocuments.map((document) => ({
        id: document.id,
        path: document.path,
        kind: document.kind,
        mime: document.mime,
      })),
    ).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        path: "/chapters/old.tex",
        kind: "text",
        mime: "text/x-tex",
      },
      {
        id: liveBinary.id,
        path: "/figure.png",
        kind: "binary",
        mime: "image/png",
      },
      {
        id: liveMain.id,
        path: "/restored/main.tex",
        kind: "text",
        mime: "text/x-tex",
      },
    ]);
    expect(
      restoredTextStates.map((row) => ({
        documentId: row.documentId,
        textContent: row.textContent,
      })),
    ).toEqual(
      [
        {
          documentId: "11111111-1111-1111-1111-111111111111",
          textContent: "\\section{Historical}",
        },
        {
          documentId: liveMain.id,
          textContent: "\\section{Restored main}",
        },
      ].sort((left, right) => left.documentId.localeCompare(right.documentId)),
    );
    expect(
      restoredTextStates.some((row) => row.documentId === newerText.id),
    ).toBe(false);
    expect(snapshots[0]?.id).toBe(restoredSnapshot.id);
    expect(checkpointState).toEqual(snapshotState);
  });

  it("fails clearly on invalid snapshot data without partially restoring", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-invalid-"),
    );
    const owner = await createUser(`snapshot-invalid-${suffix}@example.com`);
    const project = await createProject(owner.id, `Snapshot Invalid ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const liveMain = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const collaborationService = createCollaborationService();

    await textStateRepository.create({
      documentId: liveMain.id,
      ...createStoredTextState(collaborationService, "\\section{Live}"),
    });

    const snapshotStoragePath = `${project.id}/invalid.json`;
    const absoluteSnapshotPath = path.join(snapshotRoot, snapshotStoragePath);
    await mkdir(path.dirname(absoluteSnapshotPath), {
      recursive: true,
    });
    await writeFile(
      absoluteSnapshotPath,
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    const targetSnapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: snapshotStoragePath,
        message: "Invalid snapshot",
        authorId: owner.id,
      },
    });
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore: createLocalFilesystemSnapshotStore(snapshotRoot),
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: createDocumentRepository(getDb()),
      commentThreadLookup: {
        listThreadsForProject: async () => [],
      },
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    await expect(
      service.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: targetSnapshot.id,
        actorUserId: owner.id,
      }),
    ).rejects.toBeInstanceOf(InvalidSnapshotDataError);

    const documents = await getDb().document.findMany({
      where: {
        projectId: project.id,
      },
    });
    const textState = await getDb().documentTextState.findUnique({
      where: {
        documentId: liveMain.id,
      },
    });
    const snapshots = await getDb().snapshot.findMany({
      where: {
        projectId: project.id,
      },
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]?.path).toBe("/main.tex");
    expect(textState?.textContent).toBe("\\section{Live}");
    expect(snapshots).toHaveLength(1);
  });

  it("fails clearly on non-UUID snapshot document ids without partially restoring", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-invalid-id-"),
    );
    const owner = await createUser(`snapshot-invalid-id-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Snapshot Invalid Id ${suffix}`,
    );
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const liveMain = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const collaborationService = createCollaborationService();

    await textStateRepository.create({
      documentId: liveMain.id,
      ...createStoredTextState(collaborationService, "\\section{Live}"),
    });

    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const snapshotStoragePath = `${project.id}/invalid-id.json`;
    await snapshotStore.writeProjectSnapshot(snapshotStoragePath, {
      commentThreads: [],
      documents: {
        "not-a-uuid": {
          path: "/restored.tex",
          kind: "text",
          mime: "text/x-tex",
          textContent: "\\section{Broken}",
        },
      },
    });
    const targetSnapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: snapshotStoragePath,
        message: "Invalid id snapshot",
        authorId: owner.id,
      },
    });
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: createDocumentRepository(getDb()),
      commentThreadLookup: {
        listThreadsForProject: async () => [],
      },
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    await expect(
      service.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: targetSnapshot.id,
        actorUserId: owner.id,
      }),
    ).rejects.toThrow("snapshot document id must be a valid UUID");

    const documents = await getDb().document.findMany({
      where: {
        projectId: project.id,
      },
    });
    const textState = await getDb().documentTextState.findUnique({
      where: {
        documentId: liveMain.id,
      },
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]?.path).toBe("/main.tex");
    expect(textState?.textContent).toBe("\\section{Live}");
  });

  it("fails clearly on conflicting snapshot paths without partially restoring", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-invalid-paths-"),
    );
    const owner = await createUser(
      `snapshot-invalid-paths-${suffix}@example.com`,
    );
    const project = await createProject(
      owner.id,
      `Snapshot Invalid Paths ${suffix}`,
    );
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const liveMain = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const collaborationService = createCollaborationService();

    await textStateRepository.create({
      documentId: liveMain.id,
      ...createStoredTextState(collaborationService, "\\section{Live}"),
    });

    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const snapshotStoragePath = `${project.id}/invalid-paths.json`;
    await snapshotStore.writeProjectSnapshot(snapshotStoragePath, {
      commentThreads: [],
      documents: {
        "11111111-1111-1111-1111-111111111111": {
          path: "/docs",
          kind: "text",
          mime: "text/x-tex",
          textContent: "\\section{Conflict parent}",
        },
        "22222222-2222-2222-2222-222222222222": {
          path: "/docs/a.tex",
          kind: "text",
          mime: "text/x-tex",
          textContent: "\\section{Conflict child}",
        },
      },
    });
    const targetSnapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: snapshotStoragePath,
        message: "Invalid path snapshot",
        authorId: owner.id,
      },
    });
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: createDocumentRepository(getDb()),
      commentThreadLookup: {
        listThreadsForProject: async () => [],
      },
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    await expect(
      service.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: targetSnapshot.id,
        actorUserId: owner.id,
      }),
    ).rejects.toThrow(
      "snapshot document paths must not contain file/descendant conflicts",
    );

    const documents = await getDb().document.findMany({
      where: {
        projectId: project.id,
      },
    });
    const textState = await getDb().documentTextState.findUnique({
      where: {
        documentId: liveMain.id,
      },
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]?.path).toBe("/main.tex");
    expect(textState?.textContent).toBe("\\section{Live}");
  });

  it("restores renamed documents whose legal paths are already at the length limit", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-long-path-"),
    );
    const owner = await createUser(`snapshot-long-path-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Snapshot Long Path ${suffix}`,
    );
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const collaborationService = createCollaborationService();
    const currentPath = createPathOfLength(1024, "a");
    const restoredPath = createPathOfLength(1024, "b");
    const document = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: currentPath,
      kind: "text",
      mime: "text/x-tex",
    });

    await textStateRepository.create({
      documentId: document.id,
      ...createStoredTextState(collaborationService, "\\section{Live}"),
    });

    const snapshotState = {
      commentThreads: [],
      documents: {
        [document.id]: {
          path: restoredPath,
          kind: "text" as const,
          mime: "text/x-tex",
          textContent: "\\section{Restored}",
        },
      },
    };
    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const snapshotStoragePath = `${project.id}/target.json`;

    await snapshotStore.writeProjectSnapshot(
      snapshotStoragePath,
      snapshotState,
    );
    const targetSnapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: snapshotStoragePath,
        message: "Long path restore",
        authorId: owner.id,
      },
    });
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: createDocumentRepository(getDb()),
      commentThreadLookup: {
        listThreadsForProject: async () => [],
      },
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    await expect(
      service.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: targetSnapshot.id,
        actorUserId: owner.id,
      }),
    ).resolves.toBeDefined();

    const restoredDocument = await getDb().document.findUnique({
      where: {
        id: document.id,
      },
    });

    expect(restoredDocument?.path).toBe(restoredPath);
    expect(restoredDocument?.path.length).toBe(1024);
  });

  it("restores comment threads and comments from the snapshot", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-comments-"),
    );
    const owner = await createUser(`snapshot-comments-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Snapshot Comments ${suffix}`,
    );
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const commentRepository = createCommentRepository(getDb());
    const collaborationService = createCollaborationService();
    const doc = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    await textStateRepository.create({
      documentId: doc.id,
      ...createStoredTextState(
        collaborationService,
        "\\section{With comments}",
      ),
    });

    const thread = await commentRepository.createThread({
      projectId: project.id,
      documentId: doc.id,
      startAnchor: "anchor-start",
      endAnchor: "anchor-end",
      quotedText: "quoted text",
      authorId: owner.id,
      body: "First comment",
    });
    await commentRepository.addComment({
      threadId: thread.id,
      authorId: owner.id,
      body: "Second comment",
    });

    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: documentRepository,
      commentThreadLookup: commentRepository,
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    const capturedSnapshot = await service.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents: [doc],
    });

    await commentRepository.addComment({
      threadId: thread.id,
      authorId: owner.id,
      body: "Third comment added after snapshot",
    });
    await commentRepository.updateThreadStatus({
      threadId: thread.id,
      status: "resolved",
    });

    await service.restoreProjectSnapshot({
      projectId: project.id,
      snapshotId: capturedSnapshot.id,
      actorUserId: owner.id,
    });

    const restoredThreads = await getDb().commentThread.findMany({
      where: { projectId: project.id },
      include: {
        comments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });

    expect(restoredThreads).toHaveLength(1);
    expect(restoredThreads[0]?.id).toBe(thread.id);
    expect(restoredThreads[0]?.status).toBe("open");
    expect(restoredThreads[0]?.startAnchor).toBe("anchor-start");
    expect(restoredThreads[0]?.endAnchor).toBe("anchor-end");
    expect(restoredThreads[0]?.quotedText).toBe("quoted text");
    expect(restoredThreads[0]?.comments).toHaveLength(2);
    expect(restoredThreads[0]?.comments[0]?.body).toBe("First comment");
    expect(restoredThreads[0]?.comments[1]?.body).toBe("Second comment");
  });

  it("clears comment threads when restoring a snapshot with empty commentThreads", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-no-comments-"),
    );
    const owner = await createUser(
      `snapshot-no-comments-${suffix}@example.com`,
    );
    const project = await createProject(
      owner.id,
      `Snapshot No Comments ${suffix}`,
    );
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const commentRepository = createCommentRepository(getDb());
    const collaborationService = createCollaborationService();
    const doc = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    await textStateRepository.create({
      documentId: doc.id,
      ...createStoredTextState(collaborationService, "\\section{Content}"),
    });

    await commentRepository.createThread({
      projectId: project.id,
      documentId: doc.id,
      startAnchor: "a",
      endAnchor: "b",
      quotedText: "q",
      authorId: owner.id,
      body: "will be removed",
    });

    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const snapshotStoragePath = `${project.id}/no-comments.json`;

    await snapshotStore.writeProjectSnapshot(snapshotStoragePath, {
      commentThreads: [],
      documents: {
        [doc.id]: {
          path: "/main.tex",
          kind: "text",
          mime: "text/x-tex",
          textContent: "\\section{Content}",
        },
      },
    });
    const targetSnapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: snapshotStoragePath,
        message: "Snapshot without comments",
        authorId: owner.id,
      },
    });
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: documentRepository,
      commentThreadLookup: commentRepository,
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    await service.restoreProjectSnapshot({
      projectId: project.id,
      snapshotId: targetSnapshot.id,
      actorUserId: owner.id,
    });

    const threads = await getDb().commentThread.findMany({
      where: { projectId: project.id },
    });

    expect(threads).toHaveLength(0);
  });

  it("restores comments correctly when switching between older and latest snapshots", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snapshot-roundtrip-"),
    );
    const owner = await createUser(`snapshot-roundtrip-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Snapshot Roundtrip ${suffix}`,
    );
    const documentRepository = createDocumentRepository(getDb());
    const textStateRepository = createDocumentTextStateRepository(getDb());
    const commentRepository = createCommentRepository(getDb());
    const collaborationService = createCollaborationService();
    const doc = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    await textStateRepository.create({
      documentId: doc.id,
      ...createStoredTextState(collaborationService, "\\section{Content}"),
    });

    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const service = createSnapshotService({
      snapshotRepository: createSnapshotRepository(getDb()),
      snapshotStore,
      documentTextStateRepository: textStateRepository,
      collaborationService,
      projectStateRepository: createProjectStateRepository(getDb()),
      binaryContentStore: createNoopBinaryContentStore(),
      documentLookup: documentRepository,
      commentThreadLookup: commentRepository,
      getResetPublisher: () => ({
        emitDocumentReset: vi.fn(),
      }),
    });

    // State 1: one open thread with one comment
    const threadA = await commentRepository.createThread({
      projectId: project.id,
      documentId: doc.id,
      startAnchor: "a-start",
      endAnchor: "a-end",
      quotedText: "quoted A",
      authorId: owner.id,
      body: "Thread A comment",
    });

    const snapshot1 = await service.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents: [doc],
    });

    // State 2: resolve thread A, add thread B with two comments
    await commentRepository.updateThreadStatus({
      threadId: threadA.id,
      status: "resolved",
    });

    const threadB = await commentRepository.createThread({
      projectId: project.id,
      documentId: doc.id,
      startAnchor: "b-start",
      endAnchor: "b-end",
      quotedText: "quoted B",
      authorId: owner.id,
      body: "Thread B first comment",
    });
    await commentRepository.addComment({
      threadId: threadB.id,
      authorId: owner.id,
      body: "Thread B second comment",
    });

    const snapshot2 = await service.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents: [doc],
    });

    // Restore to snapshot 1: thread A open with 1 comment, thread B absent
    await service.restoreProjectSnapshot({
      projectId: project.id,
      snapshotId: snapshot1.id,
      actorUserId: owner.id,
    });

    const afterRestore1 = await getDb().commentThread.findMany({
      where: { projectId: project.id },
      include: {
        comments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    expect(afterRestore1).toHaveLength(1);
    expect(afterRestore1[0]?.id).toBe(threadA.id);
    expect(afterRestore1[0]?.status).toBe("open");
    expect(afterRestore1[0]?.comments).toHaveLength(1);
    expect(afterRestore1[0]?.comments[0]?.body).toBe("Thread A comment");

    // Restore to snapshot 2: thread A resolved, thread B present with 2 comments
    await service.restoreProjectSnapshot({
      projectId: project.id,
      snapshotId: snapshot2.id,
      actorUserId: owner.id,
    });

    const afterRestore2 = await getDb().commentThread.findMany({
      where: { projectId: project.id },
      include: {
        comments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    expect(afterRestore2).toHaveLength(2);

    const restoredA = afterRestore2.find((t) => t.id === threadA.id);
    const restoredB = afterRestore2.find((t) => t.id === threadB.id);

    expect(restoredA).toBeDefined();
    expect(restoredA?.status).toBe("resolved");
    expect(restoredA?.comments).toHaveLength(1);
    expect(restoredA?.comments[0]?.body).toBe("Thread A comment");

    expect(restoredB).toBeDefined();
    expect(restoredB?.status).toBe("open");
    expect(restoredB?.comments).toHaveLength(2);
    expect(restoredB?.comments[0]?.body).toBe("Thread B first comment");
    expect(restoredB?.comments[1]?.body).toBe("Thread B second comment");
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Snapshot User",
      passwordHash: "hash",
    },
  });
}

async function createProject(ownerUserId: string, name: string) {
  const project = await getDb().project.create({
    data: {
      name,
    },
  });

  await getDb().projectMembership.create({
    data: {
      projectId: project.id,
      userId: ownerUserId,
      role: "admin",
    },
  });

  return project;
}

function createStoredTextState(
  collaborationService: ReturnType<typeof createCollaborationService>,
  text: string,
) {
  const document = collaborationService.createDocumentFromText(text);

  try {
    return {
      yjsState: document.exportUpdate(),
      textContent: document.getText(),
    };
  } finally {
    document.destroy();
  }
}

function createNoopBinaryContentStore() {
  return {
    get: async () => Buffer.alloc(0),
    put: async () => {},
    delete: async () => {},
  };
}

function createPathOfLength(totalLength: number, character: string) {
  return `/${character.repeat(totalLength - 1)}`;
}
