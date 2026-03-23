import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createProjectStateRepository } from "../repositories/projectStateRepository.js";
import { createSnapshotRepository } from "../repositories/snapshotRepository.js";
import {
  createSnapshotRefreshJobRepository,
  queueSnapshotRefreshJob,
} from "../repositories/snapshotRefreshJobRepository.js";
import { createCollaborationService } from "../services/collaboration.js";
import { createSnapshotService } from "../services/snapshot.js";
import { createSnapshotRefreshProcessor } from "../services/snapshotRefresh.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;
let tmpRoot: string;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

/**
 * Drain the processor queue until no more jobs are available.
 * This ensures our test job is processed even if other tests left
 * queued jobs in the shared database.
 */
async function drainQueue(
  processor: ReturnType<typeof createSnapshotRefreshProcessor>,
) {
  while (await processor.processNextJob()) {
    // keep processing
  }
}

describe("snapshot refresh processing integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
    tmpRoot = await mkdtemp(
      path.join(os.tmpdir(), "collabtex-snap-refresh-test-"),
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

  function buildProcessor(overrides?: {
    snapshotService?: {
      captureProjectSnapshot: (...args: unknown[]) => Promise<never>;
    };
  }) {
    const snapshotRoot = path.join(tmpRoot, `snapshots-${randomUUID()}`);
    const snapshotRefreshJobRepository =
      createSnapshotRefreshJobRepository(getDb());
    const documentRepository = createDocumentRepository(getDb());
    const projectRepository = createProjectRepository(getDb());
    const snapshotRepository = createSnapshotRepository(getDb());
    const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
    const documentTextStateRepository =
      createDocumentTextStateRepository(getDb());
    const projectStateRepository = createProjectStateRepository(getDb());
    const collaborationService = createCollaborationService();

    const snapshotService =
      overrides?.snapshotService ??
      createSnapshotService({
        snapshotRepository,
        snapshotStore,
        documentTextStateRepository,
        collaborationService,
        projectStateRepository,
        binaryContentStore: {
          get: async () => Buffer.alloc(0),
          put: async () => {},
          delete: async () => {},
        },
        documentLookup: documentRepository,
        commentThreadLookup: {
          listThreadsForProject: async () => [],
        },
      });

    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository,
      projectLookup: projectRepository,
      snapshotService,
      documentRepository,
    });

    return {
      processor,
      snapshotRefreshJobRepository,
      snapshotRepository,
    };
  }

  it("claims and processes a queued job successfully", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`snap-proc-${suffix}@example.com`);
    const project = await createProject(owner.id, `SnapProc ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    await getDb().$transaction(async (tx) => {
      await queueSnapshotRefreshJob(tx, {
        projectId: project.id,
        requestedByUserId: owner.id,
      });
    });

    const { processor, snapshotRepository } = buildProcessor();
    await drainQueue(processor);

    const jobs = await getDb().snapshotRefreshJob.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "succeeded",
        lastError: null,
      }),
    );
    expect(jobs[0]!.finishedAt).not.toBeNull();

    const snapshots = await snapshotRepository.listForProject(project.id);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
  });

  it("marks job as failed when snapshot capture throws", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`snap-fail-${suffix}@example.com`);
    const project = await createProject(owner.id, `SnapFail ${suffix}`);

    await getDb().$transaction(async (tx) => {
      await queueSnapshotRefreshJob(tx, {
        projectId: project.id,
        requestedByUserId: owner.id,
      });
    });

    const { processor } = buildProcessor({
      snapshotService: {
        captureProjectSnapshot: async () => {
          throw new Error("Simulated capture failure");
        },
      },
    });

    // Drain processes all jobs; our test job will fail while others may succeed
    await drainQueue(processor);

    const job = await getDb().snapshotRefreshJob.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(job).toEqual(
      expect.objectContaining({
        status: "failed",
        lastError: "snapshot refresh failed; see logs for details",
      }),
    );
    expect(job!.finishedAt).not.toBeNull();
  });

  it("retries failed jobs ordered by finishedAt then createdAt", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`snap-retry-${suffix}@example.com`);
    const project = await createProject(owner.id, `SnapRetry ${suffix}`);

    // First drain any existing queued/failed jobs so they don't interfere
    const { snapshotRefreshJobRepository } = buildProcessor();
    const drainProcessor = buildProcessor();
    await drainQueue(drainProcessor.processor);

    const now = Date.now();
    const jobIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const job = await getDb().snapshotRefreshJob.create({
        data: {
          projectId: project.id,
          requestedByUserId: owner.id,
          status: "failed",
          attemptCount: 1,
          lastError: "previous failure",
          startedAt: new Date(now - 30000),
          finishedAt: new Date(now - (3 - i) * 10000),
          createdAt: new Date(now - 60000 + i * 1000),
        },
      });
      jobIds.push(job.id);
    }

    const claimed1 = await snapshotRefreshJobRepository.claimNextJob();
    expect(claimed1!.id).toBe(jobIds[0]);
    await snapshotRefreshJobRepository.markJobSucceeded(claimed1!.id);

    const claimed2 = await snapshotRefreshJobRepository.claimNextJob();
    expect(claimed2!.id).toBe(jobIds[1]);
    await snapshotRefreshJobRepository.markJobSucceeded(claimed2!.id);

    const claimed3 = await snapshotRefreshJobRepository.claimNextJob();
    expect(claimed3!.id).toBe(jobIds[2]);
    await snapshotRefreshJobRepository.markJobSucceeded(claimed3!.id);
  });

  it("skips soft-deleted projects and marks job succeeded", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`snap-del-${suffix}@example.com`);
    const project = await createProject(owner.id, `SnapDel ${suffix}`);

    await getDb().$transaction(async (tx) => {
      await queueSnapshotRefreshJob(tx, {
        projectId: project.id,
        requestedByUserId: owner.id,
      });
    });

    await getDb().project.update({
      where: { id: project.id },
      data: { tombstoneAt: new Date() },
    });

    const { processor, snapshotRepository } = buildProcessor();
    await drainQueue(processor);

    const job = await getDb().snapshotRefreshJob.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(job).toEqual(
      expect.objectContaining({
        status: "succeeded",
        lastError: null,
      }),
    );

    const snapshots = await snapshotRepository.listForProject(project.id);
    expect(snapshots).toHaveLength(0);
  });

  it("recovers interrupted jobs and retries them successfully", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`snap-recov-${suffix}@example.com`);
    const project = await createProject(owner.id, `SnapRecov ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    await getDb().snapshotRefreshJob.create({
      data: {
        projectId: project.id,
        requestedByUserId: owner.id,
        status: "processing",
        attemptCount: 1,
        startedAt: new Date(),
      },
    });

    const { processor, snapshotRefreshJobRepository } = buildProcessor();
    const recovered =
      await snapshotRefreshJobRepository.recoverInterruptedJobs();
    expect(recovered).toBeGreaterThanOrEqual(1);

    await drainQueue(processor);

    const job = await getDb().snapshotRefreshJob.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(job).toEqual(
      expect.objectContaining({
        status: "succeeded",
        attemptCount: 2,
      }),
    );
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Snapshot Test User",
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
