import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import type { StoredSnapshotRefreshJob } from "../services/snapshotRefresh.js";

export function createSnapshotRefreshJobRepository(
  databaseClient: DatabaseClient,
) {
  return {
    recoverInterruptedJobs: async () => {
      const result = await databaseClient.snapshotRefreshJob.updateMany({
        where: {
          status: "processing",
        },
        data: {
          status: "failed",
          lastError: "snapshot refresh interrupted",
          finishedAt: new Date(),
        },
      });

      return result.count;
    },
    claimNextJob: async (): Promise<StoredSnapshotRefreshJob | null> => {
      while (true) {
        const nextJob =
          (await findNextClaimableJob(databaseClient, "queued")) ??
          (await findNextClaimableJob(databaseClient, "failed"));

        if (!nextJob) {
          return null;
        }

        const claimed = await databaseClient.snapshotRefreshJob.updateMany({
          where: {
            id: nextJob.id,
            status: {
              in: ["queued", "failed"],
            },
          },
          data: {
            status: "processing",
            attemptCount: {
              increment: 1,
            },
            startedAt: new Date(),
            finishedAt: null,
          },
        });

        if (claimed.count === 0) {
          continue;
        }

        const claimedJob = await databaseClient.snapshotRefreshJob.findUnique({
          where: {
            id: nextJob.id,
          },
        });

        if (!claimedJob) {
          throw new Error("Expected claimed snapshot refresh job to exist");
        }

        return claimedJob;
      }
    },
    markJobSucceeded: async (jobId: string) => {
      await databaseClient.snapshotRefreshJob.update({
        where: {
          id: jobId,
        },
        data: {
          status: "succeeded",
          lastError: null,
          finishedAt: new Date(),
        },
      });
    },
    markJobFailed: async (jobId: string, lastError: string) => {
      await databaseClient.snapshotRefreshJob.update({
        where: {
          id: jobId,
        },
        data: {
          status: "failed",
          lastError,
          finishedAt: new Date(),
        },
      });
    },
  };
}

async function findNextClaimableJob(
  databaseClient: DatabaseClient,
  status: "queued" | "failed",
) {
  return databaseClient.snapshotRefreshJob.findFirst({
    where: {
      status,
    },
    orderBy:
      status === "queued"
        ? {
            createdAt: "asc",
          }
        : [
            {
              finishedAt: "asc",
            },
            {
              createdAt: "asc",
            },
          ],
  });
}

export async function queueSnapshotRefreshJob(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    requestedByUserId: string;
  },
): Promise<void> {
  await tx.snapshotRefreshJob.create({
    data: {
      projectId: input.projectId,
      requestedByUserId: input.requestedByUserId,
    },
  });
}
