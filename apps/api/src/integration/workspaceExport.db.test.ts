import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
import { createLocalFilesystemBinaryContentStore } from "../infrastructure/storage/localFilesystemBinaryContentStore.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createProjectStateRepository } from "../repositories/projectStateRepository.js";
import { createSnapshotRepository } from "../repositories/snapshotRepository.js";
import { createCollaborationService } from "../services/collaboration.js";
import { createSnapshotService } from "../services/snapshot.js";
import {
  assembleProjectFiles,
  type FileAssemblyDependencies,
} from "../services/workspaceExport.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;
let tmpRoot: string;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("workspace export integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
    tmpRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-export-test-"),
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

  function buildDeps(): FileAssemblyDependencies & {
    helpers: {
      snapshotService: ReturnType<typeof createSnapshotService>;
      binaryContentStore: ReturnType<
        typeof createLocalFilesystemBinaryContentStore
      >;
    };
  } {
    const snapshotRoot = path.join(tmpRoot, `snapshots-${randomUUID()}`);
    const binaryRoot = path.join(tmpRoot, `binary-${randomUUID()}`);

    const documentRepository = createDocumentRepository(getDb());
    const documentTextStateRepository =
      createDocumentTextStateRepository(getDb());
    const snapshotRepository = createSnapshotRepository(getDb());
    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const binaryContentStore =
      createLocalFilesystemBinaryContentStore(binaryRoot);
    const projectStateRepository = createProjectStateRepository(getDb());
    const collaborationService = createCollaborationService();

    const snapshotService = createSnapshotService({
      snapshotRepository,
      snapshotStore,
      documentTextStateRepository,
      collaborationService,
      projectStateRepository,
      binaryContentStore,
      documentLookup: documentRepository,
      commentThreadLookup: {
        listThreadsForProject: async () => [],
      },
    });

    return {
      documentRepository,
      documentTextStateRepository,
      snapshotRepository,
      snapshotStore,
      binaryContentStore,
      helpers: { snapshotService, binaryContentStore },
    };
  }

  it("exports project with mix of text and binary files", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`export-mix-${suffix}@example.com`);
    const project = await createProject(owner.id, `ExportMix ${suffix}`);
    const deps = buildDeps();

    const textDoc = await deps.documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    const binaryDoc = await deps.documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/figures/logo.png",
      kind: "binary",
      mime: "image/png",
    });

    // Persist text state
    await deps.documentTextStateRepository.create({
      documentId: textDoc.id,
      yjsState: new Uint8Array([0]),
      textContent: "\\documentclass{article}",
    });

    // Upload binary content
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await deps.helpers.binaryContentStore.put(
      `${project.id}/${binaryDoc.id}`,
      pngBytes,
    );

    // Capture snapshot so export has fallback data
    const documents = await deps.documentRepository.listForProject(project.id);
    await deps.helpers.snapshotService.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents,
    });

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toHaveLength(2);

    const textFile = files.find((f) => f.relativePath === "main.tex");
    expect(textFile).toEqual({
      relativePath: "main.tex",
      kind: "text",
      content: "\\documentclass{article}",
    });

    const binaryFile = files.find(
      (f) => f.relativePath === "figures/logo.png",
    );
    expect(binaryFile).toBeDefined();
    expect(binaryFile!.kind).toBe("binary");
    expect(Buffer.isBuffer(binaryFile!.content)).toBe(true);
  });

  it("prefers mutable text state over snapshot content", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`export-edit-${suffix}@example.com`);
    const project = await createProject(owner.id, `ExportEdit ${suffix}`);
    const deps = buildDeps();

    const textDoc = await deps.documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    // Create initial text state and snapshot with "v1"
    await deps.documentTextStateRepository.create({
      documentId: textDoc.id,
      yjsState: new Uint8Array([0]),
      textContent: "version 1",
    });

    const documents = await deps.documentRepository.listForProject(project.id);
    await deps.helpers.snapshotService.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents,
    });

    // Update text state to "v2"
    await deps.documentTextStateRepository.update({
      documentId: textDoc.id,
      yjsState: new Uint8Array([1]),
      textContent: "version 2",
      expectedVersion: 1,
    });

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      relativePath: "main.tex",
      kind: "text",
      content: "version 2",
    });
  });

  it("falls back to snapshot for binary file with no mutable content", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`export-binfb-${suffix}@example.com`);
    const project = await createProject(owner.id, `ExportBinFB ${suffix}`);
    const deps = buildDeps();

    const binaryDoc = await deps.documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/image.png",
      kind: "binary",
      mime: "image/png",
    });

    // Upload binary so snapshot captures it, then remove from mutable store
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    await deps.helpers.binaryContentStore.put(
      `${project.id}/${binaryDoc.id}`,
      pngBytes,
    );

    const documents = await deps.documentRepository.listForProject(project.id);
    await deps.helpers.snapshotService.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents,
    });

    // Remove from mutable store to force snapshot fallback
    await deps.helpers.binaryContentStore.delete(
      `${project.id}/${binaryDoc.id}`,
    );

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toHaveLength(1);
    expect(files[0]!.kind).toBe("binary");
    expect(files[0]!.relativePath).toBe("image.png");
    // Content should be decoded from snapshot base64
    expect(Buffer.isBuffer(files[0]!.content)).toBe(true);
    expect((files[0]!.content as Buffer).length).toBeGreaterThan(0);
  });

  it("exports empty project as empty array", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`export-empty-${suffix}@example.com`);
    const project = await createProject(owner.id, `ExportEmpty ${suffix}`);
    const deps = buildDeps();

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toEqual([]);
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Export Test User",
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
