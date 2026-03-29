import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  hasRecentPendingJob,
  queueSnapshotRefreshJob,
} from "../repositories/snapshotRefreshJobRepository.js";
import type { SnapshotRepository } from "./snapshot.js";
import type { SnapshotRefreshTrigger } from "./snapshotRefresh.js";

const DEFAULT_MIN_INTERVAL_MS = 30_000;

export type QueueProjectSnapshot = (
  projectId: string,
  userId: string | null,
  minIntervalMs?: number,
) => Promise<void>;

export function createQueueProjectSnapshot({
  databaseClient,
  snapshotRepository,
  snapshotRefreshTrigger,
}: {
  databaseClient: DatabaseClient;
  snapshotRepository: Pick<SnapshotRepository, "getLatestSnapshotTime">;
  snapshotRefreshTrigger: Pick<SnapshotRefreshTrigger, "kick">;
}): QueueProjectSnapshot {
  return async (projectId, userId, minIntervalMs = DEFAULT_MIN_INTERVAL_MS) => {
    const latestTime =
      await snapshotRepository.getLatestSnapshotTime(projectId);
    if (latestTime && Date.now() - latestTime.getTime() < minIntervalMs) {
      return;
    }

    let queued = false;
    await databaseClient.$transaction(async (tx) => {
      const hasPending = await hasRecentPendingJob(tx, projectId);
      if (hasPending) return;

      await queueSnapshotRefreshJob(tx, {
        projectId,
        requestedByUserId: userId,
      });
      queued = true;
    });

    if (queued) {
      snapshotRefreshTrigger.kick();
    }
  };
}
