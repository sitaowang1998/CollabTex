import type { ActiveDocumentRegistry } from "./activeDocumentRegistry.js";
import type { QueueProjectSnapshot } from "./snapshotQueue.js";

const PERIODIC_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;

export type SnapshotPeriodicTrigger = {
  stop: () => void;
};

export function createSnapshotPeriodicTrigger({
  activeDocumentRegistry,
  queueProjectSnapshot,
  pollIntervalMs = POLL_INTERVAL_MS,
  snapshotIntervalMs = PERIODIC_SNAPSHOT_INTERVAL_MS,
}: {
  activeDocumentRegistry: Pick<ActiveDocumentRegistry, "getActiveProjectIds">;
  queueProjectSnapshot: QueueProjectSnapshot;
  pollIntervalMs?: number;
  snapshotIntervalMs?: number;
}): SnapshotPeriodicTrigger {
  let stopped = false;

  const intervalHandle = setInterval(() => {
    if (stopped) return;
    void checkAndQueue();
  }, pollIntervalMs);

  intervalHandle.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(intervalHandle);
    },
  };

  async function checkAndQueue(): Promise<void> {
    let projectIds: string[];
    try {
      projectIds = activeDocumentRegistry.getActiveProjectIds();
    } catch (error) {
      console.error(
        "Periodic snapshot trigger: failed to get active projects",
        error,
      );
      return;
    }

    for (const projectId of projectIds) {
      if (stopped) return;
      try {
        await queueProjectSnapshot(projectId, null, snapshotIntervalMs);
      } catch (error) {
        console.error(
          "Periodic snapshot trigger failed for project",
          { projectId },
          error,
        );
      }
    }
  }
}
