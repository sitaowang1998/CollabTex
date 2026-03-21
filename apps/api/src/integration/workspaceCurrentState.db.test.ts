import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectStateRepository } from "../repositories/projectStateRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createSnapshotRepository } from "../repositories/snapshotRepository.js";
import { createCollaborationService } from "../services/collaboration.js";
import { createCurrentTextStateService } from "../services/currentTextState.js";
import { createProjectAccessService } from "../services/projectAccess.js";
import { createSnapshotService } from "../services/snapshot.js";
import { createWorkspaceService } from "../services/workspace.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("workspace current state integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("reopens text documents from persisted current state instead of newer snapshot ordering", async () => {
    const suffix = randomUUID();
    const snapshotRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-workspace-state-"),
    );
    const owner = await createUser(`workspace-state-${suffix}@example.com`);
    const project = await createProject(owner.id, `Workspace State ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const document = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const firstSnapshotContent = "\\section{Snapshot v1}";
    const secondSnapshotContent = "\\section{Snapshot v2}";

    await writeSnapshot({
      projectId: project.id,
      storagePath: `${project.id}/snapshot-1.json`,
      createdAt: new Date("2026-03-10T12:00:00.000Z"),
      content: firstSnapshotContent,
      documentId: document.id,
      snapshotStore,
      authorId: owner.id,
    });

    const firstRuntime = createRuntime(snapshotRoot);
    const firstOpen = await firstRuntime.workspaceService.openDocument({
      projectId: project.id,
      documentId: document.id,
      userId: owner.id,
    });

    expect(firstOpen.workspace.content).toBeNull();
    expect(firstOpen.initialSync).toMatchObject({
      documentId: document.id,
      serverVersion: 1,
    });
    await expect(
      firstRuntime.documentTextStateRepository.findByDocumentId(document.id),
    ).resolves.toMatchObject({
      textContent: firstSnapshotContent,
      version: 1,
    });

    await writeSnapshot({
      projectId: project.id,
      storagePath: `${project.id}/snapshot-2.json`,
      createdAt: new Date("2026-03-11T12:00:00.000Z"),
      content: secondSnapshotContent,
      documentId: document.id,
      snapshotStore,
      authorId: owner.id,
    });

    const secondRuntime = createRuntime(snapshotRoot);
    const reopened = await secondRuntime.workspaceService.openDocument({
      projectId: project.id,
      documentId: document.id,
      userId: owner.id,
    });

    expect(reopened.workspace.content).toBeNull();
    expect(reopened.initialSync).toMatchObject({
      documentId: document.id,
      serverVersion: 1,
    });
    await expect(
      secondRuntime.documentTextStateRepository.findByDocumentId(document.id),
    ).resolves.toMatchObject({
      textContent: firstSnapshotContent,
      version: 1,
    });
  });
});

function createRuntime(snapshotRoot: string) {
  const collaborationService = createCollaborationService();
  const documentTextStateRepository =
    createDocumentTextStateRepository(getDb());
  const snapshotService = createSnapshotService({
    snapshotRepository: createSnapshotRepository(getDb()),
    snapshotStore: createLocalFilesystemSnapshotStore(snapshotRoot),
    documentTextStateRepository,
    collaborationService,
    projectStateRepository: createProjectStateRepository(getDb()),
    binaryContentStore: {
      get: async () => Buffer.alloc(0),
      put: async () => {},
      delete: async () => {},
    },
    documentLookup: createDocumentRepository(getDb()),
  });
  const currentTextStateService = createCurrentTextStateService({
    documentTextStateRepository,
    snapshotService,
    collaborationService,
  });

  return {
    documentTextStateRepository,
    workspaceService: createWorkspaceService({
      projectAccessService: createProjectAccessService({
        projectRepository: createProjectRepository(getDb()),
      }),
      documentRepository: createDocumentRepository(getDb()),
      currentTextStateService,
    }),
  };
}

async function writeSnapshot({
  projectId,
  storagePath,
  createdAt,
  content,
  documentId,
  snapshotStore,
  authorId,
}: {
  projectId: string;
  storagePath: string;
  createdAt: Date;
  content: string;
  documentId: string;
  snapshotStore: ReturnType<typeof createLocalFilesystemSnapshotStore>;
  authorId: string;
}) {
  await snapshotStore.writeProjectSnapshot(storagePath, {
    version: 2,
    documents: {
      [documentId]: {
        path: "/main.tex",
        kind: "text",
        mime: "text/x-tex",
        textContent: content,
      },
    },
  });
  await getDb().snapshot.create({
    data: {
      projectId,
      storagePath,
      message: null,
      authorId,
      createdAt,
    },
  });
}

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Workspace Test User",
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
