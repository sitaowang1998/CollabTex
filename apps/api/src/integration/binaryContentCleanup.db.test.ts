import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemBinaryContentStore } from "../infrastructure/storage/localFilesystemBinaryContentStore.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createProjectAccessService } from "../services/projectAccess.js";
import { BinaryContentNotFoundError } from "../services/binaryContent.js";
import { createDocumentService, type DocumentService } from "../services/document.js";
import type { SnapshotService } from "../services/snapshot.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;
let tmpRoot: string;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("binary content cleanup on delete integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
    tmpRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-cleanup-test-"),
    );
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  function buildService(): {
    documentService: DocumentService;
    binaryContentStore: ReturnType<
      typeof createLocalFilesystemBinaryContentStore
    >;
  } {
    const binaryRoot = path.join(tmpRoot, `binary-${randomUUID()}`);
    const documentRepository = createDocumentRepository(getDb());
    const projectRepository = createProjectRepository(getDb());
    const projectAccessService = createProjectAccessService({
      projectRepository,
    });
    const binaryContentStore =
      createLocalFilesystemBinaryContentStore(binaryRoot);

    const stubSnapshotService = {
      loadDocumentContent: async () => "",
      captureProjectSnapshot: async () => {
        throw new Error("not implemented in test");
      },
      listProjectSnapshots: async () => [],
      getProjectSnapshotContent: async () => {
        throw new Error("not implemented in test");
      },
      restoreProjectSnapshot: async () => {
        throw new Error("not implemented in test");
      },
    } as unknown as SnapshotService;

    const documentService = createDocumentService({
      documentRepository,
      projectAccessService,
      snapshotService: stubSnapshotService,
      snapshotRefreshTrigger: { kick: () => {}, stop: () => {} },
      binaryContentStore,
    });

    return { documentService, binaryContentStore };
  }

  it("removes binary content from store when deleting a binary document", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`cleanup-single-${suffix}@example.com`);
    const project = await createProject(owner.id, `CleanupSingle ${suffix}`);
    const { documentService, binaryContentStore } = buildService();

    const documentRepository = createDocumentRepository(getDb());
    const binaryDoc = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/image.png",
      kind: "binary",
      mime: "image/png",
    });

    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await binaryContentStore.put(`${project.id}/${binaryDoc.id}`, content);

    // Verify content exists before delete
    const stored = await binaryContentStore.get(
      `${project.id}/${binaryDoc.id}`,
    );
    expect(stored).toEqual(content);

    await documentService.deleteNode({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/image.png",
    });

    await expect(
      binaryContentStore.get(`${project.id}/${binaryDoc.id}`),
    ).rejects.toThrow(BinaryContentNotFoundError);
  });

  it("removes all binary content when deleting a folder", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`cleanup-folder-${suffix}@example.com`);
    const project = await createProject(owner.id, `CleanupFolder ${suffix}`);
    const { documentService, binaryContentStore } = buildService();

    const documentRepository = createDocumentRepository(getDb());
    const binDocA = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/figures/a.png",
      kind: "binary",
      mime: "image/png",
    });

    const binDocB = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/figures/b.jpg",
      kind: "binary",
      mime: "image/jpeg",
    });

    await binaryContentStore.put(
      `${project.id}/${binDocA.id}`,
      Buffer.from([1, 2, 3]),
    );
    await binaryContentStore.put(
      `${project.id}/${binDocB.id}`,
      Buffer.from([4, 5, 6]),
    );

    await documentService.deleteNode({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/figures",
    });

    await expect(
      binaryContentStore.get(`${project.id}/${binDocA.id}`),
    ).rejects.toThrow(BinaryContentNotFoundError);

    await expect(
      binaryContentStore.get(`${project.id}/${binDocB.id}`),
    ).rejects.toThrow(BinaryContentNotFoundError);
  });

  it("deleting a text document does not error on binary cleanup", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`cleanup-text-${suffix}@example.com`);
    const project = await createProject(owner.id, `CleanupText ${suffix}`);
    const { documentService } = buildService();

    const documentRepository = createDocumentRepository(getDb());
    await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    // Should not throw — no binary cleanup needed
    await documentService.deleteNode({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
    });
  });

  it("deleting binary document with no uploaded content does not error", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`cleanup-noup-${suffix}@example.com`);
    const project = await createProject(owner.id, `CleanupNoUp ${suffix}`);
    const { documentService } = buildService();

    const documentRepository = createDocumentRepository(getDb());
    await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/empty.png",
      kind: "binary",
      mime: "image/png",
    });

    // Should not throw — idempotent delete in store
    await documentService.deleteNode({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/empty.png",
    });
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Cleanup Test User",
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
