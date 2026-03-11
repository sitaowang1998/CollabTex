import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createSnapshotRefreshJobRepository } from "../repositories/snapshotRefreshJobRepository.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("snapshot refresh job repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("reclaims interrupted processing jobs so they are claimable again", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`refresh-owner-${suffix}@example.com`);
    const project = await createProject(owner.id, `Refresh ${suffix}`);
    const repository = createSnapshotRefreshJobRepository(getDb());

    const job = await getDb().snapshotRefreshJob.create({
      data: {
        projectId: project.id,
        requestedByUserId: owner.id,
        status: "processing",
        attemptCount: 1,
        startedAt: new Date("2026-03-10T12:00:00.000Z"),
      },
    });

    await expect(repository.recoverInterruptedJobs()).resolves.toBe(1);
    await expect(
      getDb().snapshotRefreshJob.findUnique({
        where: {
          id: job.id,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: job.id,
        status: "failed",
        attemptCount: 1,
        lastError: "snapshot refresh interrupted",
      }),
    );
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Snapshot Owner",
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
