import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createSnapshotRefreshJobRepository } from "./snapshotRefreshJobRepository.js";

describe("snapshot refresh job repository", () => {
  it("claims queued jobs without filtering out tombstoned projects", async () => {
    const claimedJob = createJob({
      id: "job-1",
      status: "processing",
      attemptCount: 1,
      startedAt: new Date("2026-03-11T12:05:00.000Z"),
    });
    const databaseClient = createDatabaseClient({
      queuedJob: createJob({
        id: "job-1",
        status: "queued",
      }),
      claimedJob,
    });
    const repository = createSnapshotRefreshJobRepository(databaseClient);

    await expect(repository.claimNextJob()).resolves.toEqual(claimedJob);
    expect(databaseClient.snapshotRefreshJob.findFirst).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          status: "queued",
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    );
  });

  it("retries failed jobs by oldest failure time", async () => {
    const claimedJob = createJob({
      id: "job-2",
      status: "processing",
      attemptCount: 2,
      startedAt: new Date("2026-03-11T12:10:00.000Z"),
    });
    const databaseClient = createDatabaseClient({
      failedJob: createJob({
        id: "job-2",
        status: "failed",
        createdAt: new Date("2026-03-11T10:00:00.000Z"),
        finishedAt: new Date("2026-03-11T11:00:00.000Z"),
      }),
      claimedJob,
    });
    const repository = createSnapshotRefreshJobRepository(databaseClient);

    await expect(repository.claimNextJob()).resolves.toEqual(claimedJob);
    expect(databaseClient.snapshotRefreshJob.findFirst).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          status: "failed",
        },
        orderBy: [
          {
            finishedAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      },
    );
  });
});

function createDatabaseClient(options: {
  queuedJob?: ReturnType<typeof createJob> | null;
  failedJob?: ReturnType<typeof createJob> | null;
  claimedJob: ReturnType<typeof createJob>;
}): DatabaseClient {
  const findFirst = vi.fn().mockImplementation(async (query: unknown) => {
    const status = getClaimStatus(query);

    if (status === "queued") {
      return options.queuedJob ?? null;
    }

    if (status === "failed") {
      return options.failedJob ?? null;
    }

    return null;
  });

  return {
    snapshotRefreshJob: {
      findFirst,
      updateMany: vi.fn().mockResolvedValue({
        count: 1,
      }),
      findUnique: vi.fn().mockResolvedValue(options.claimedJob),
    },
  } as unknown as DatabaseClient;
}

function getClaimStatus(query: unknown): "queued" | "failed" | null {
  if (
    typeof query !== "object" ||
    query === null ||
    !("where" in query) ||
    typeof query.where !== "object" ||
    query.where === null ||
    !("status" in query.where)
  ) {
    return null;
  }

  return query.where.status === "queued" || query.where.status === "failed"
    ? query.where.status
    : null;
}

function createJob(
  overrides: Partial<{
    id: string;
    projectId: string;
    requestedByUserId: string | null;
    status: "queued" | "processing" | "succeeded" | "failed";
    attemptCount: number;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }> = {},
) {
  return {
    id: "job-1",
    projectId: "project-1",
    requestedByUserId: "user-1",
    status: "queued" as const,
    attemptCount: 0,
    lastError: null,
    createdAt: new Date("2026-03-11T12:00:00.000Z"),
    updatedAt: new Date("2026-03-11T12:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}
