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

function createTextState(text: string): {
  yjsState: Uint8Array;
  textContent: string;
} {
  const collaborationService = createCollaborationService();
  const doc = collaborationService.createDocumentFromText(text);

  try {
    return {
      yjsState: doc.exportUpdate(),
      textContent: doc.getText(),
    };
  } finally {
    doc.destroy();
  }
}

describe("workspace export integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "collabtex-export-test-"));
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true }).catch((err) =>
        console.warn("Temp dir cleanup failed:", err),
      );
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

    const textState = createTextState("\\documentclass{article}");
    await deps.documentTextStateRepository.create({
      documentId: textDoc.id,
      ...textState,
    });

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
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

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toHaveLength(2);

    const textFile = files.find((f) => f.relativePath === "main.tex");
    expect(textFile).toEqual({
      relativePath: "main.tex",
      kind: "text",
      content: "\\documentclass{article}",
    });

    const binaryFile = files.find((f) => f.relativePath === "figures/logo.png");
    expect(binaryFile).toBeDefined();
    expect(binaryFile!.kind).toBe("binary");
    expect(binaryFile!.content).toEqual(pngBytes);
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

    const v1State = createTextState("version 1");
    await deps.documentTextStateRepository.create({
      documentId: textDoc.id,
      ...v1State,
    });

    const documents = await deps.documentRepository.listForProject(project.id);
    await deps.helpers.snapshotService.captureProjectSnapshot({
      projectId: project.id,
      authorId: owner.id,
      documents,
    });

    const v2State = createTextState("version 2");
    await deps.documentTextStateRepository.update({
      documentId: textDoc.id,
      ...v2State,
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
    // Content decoded from snapshot base64 should match original bytes
    expect(files[0]!.content).toEqual(pngBytes);
  });

  it("exports text document with no state and no snapshot as empty string", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`export-nostate-${suffix}@example.com`);
    const project = await createProject(owner.id, `ExportNoState ${suffix}`);
    const deps = buildDeps();

    await deps.documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/empty.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      relativePath: "empty.tex",
      kind: "text",
      content: "",
    });
  });

  it("skips binary document with no mutable content and no snapshot", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`export-nobin-${suffix}@example.com`);
    const project = await createProject(owner.id, `ExportNoBin ${suffix}`);
    const deps = buildDeps();

    await deps.documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/missing.png",
      kind: "binary",
      mime: "image/png",
    });

    const files = await assembleProjectFiles(deps, project.id);

    expect(files).toEqual([]);
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
