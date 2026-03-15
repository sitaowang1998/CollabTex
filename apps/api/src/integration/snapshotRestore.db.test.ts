import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
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
      version: 2 as const,
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
      resetPublisher: {
        emitDocumentReset: vi.fn(),
      },
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
    ).toEqual([
      {
        documentId: "11111111-1111-1111-1111-111111111111",
        textContent: "\\section{Historical}",
      },
      {
        documentId: liveMain.id,
        textContent: "\\section{Restored main}",
      },
    ]);
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
      resetPublisher: {
        emitDocumentReset: vi.fn(),
      },
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
      version: 2 as const,
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
      resetPublisher: {
        emitDocumentReset: vi.fn(),
      },
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

function createPathOfLength(totalLength: number, character: string) {
  return `/${character.repeat(totalLength - 1)}`;
}
