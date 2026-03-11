import type { DocumentRepository } from "./document.js";
import {
  buildProjectSnapshotState,
  createSnapshotStoragePath,
  loadLatestUsableProjectSnapshotState,
  type SnapshotRepository,
  type SnapshotStore,
} from "./snapshot.js";

export type SnapshotRefreshJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export type StoredSnapshotRefreshJob = {
  id: string;
  projectId: string;
  requestedByUserId: string | null;
  status: SnapshotRefreshJobStatus;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type SnapshotRefreshJobRepository = {
  claimNextJob: () => Promise<StoredSnapshotRefreshJob | null>;
  recoverInterruptedJobs: () => Promise<number>;
  markJobSucceeded: (jobId: string) => Promise<void>;
  markJobFailed: (jobId: string, lastError: string) => Promise<void>;
};

export type SnapshotRefreshProjectLookup = {
  findActiveById: (projectId: string) => Promise<{ id: string } | null>;
};

export type SnapshotRefreshProcessor = {
  processNextJob: () => Promise<boolean>;
};

export type SnapshotRefreshTrigger = {
  kick: () => void;
  stop: () => void;
};

export function createSnapshotRefreshProcessor({
  snapshotRefreshJobRepository,
  projectLookup,
  snapshotRepository,
  snapshotStore,
  documentRepository,
}: {
  snapshotRefreshJobRepository: SnapshotRefreshJobRepository;
  projectLookup: SnapshotRefreshProjectLookup;
  snapshotRepository: SnapshotRepository;
  snapshotStore: SnapshotStore;
  documentRepository: Pick<DocumentRepository, "listForProject">;
}): SnapshotRefreshProcessor {
  return {
    processNextJob: async () => {
      const job = await snapshotRefreshJobRepository.claimNextJob();

      if (!job) {
        return false;
      }

      try {
        const project = await projectLookup.findActiveById(job.projectId);

        if (!project) {
          await snapshotRefreshJobRepository.markJobSucceeded(job.id);

          return true;
        }

        const documents = await documentRepository.listForProject(
          job.projectId,
        );
        const previousState = await loadLatestUsableProjectSnapshotState(
          snapshotRepository,
          snapshotStore,
          job.projectId,
        );
        const nextState = buildProjectSnapshotState(documents, previousState);
        const storagePath = createSnapshotStoragePath(job.projectId);

        await snapshotStore.writeProjectSnapshot(storagePath, nextState);
        await snapshotRepository.createSnapshot({
          projectId: job.projectId,
          storagePath,
          message: null,
          authorId: job.requestedByUserId,
        });
        await snapshotRefreshJobRepository.markJobSucceeded(job.id);

        return true;
      } catch (error) {
        console.error(
          "Snapshot refresh job failed",
          {
            jobId: job.id,
            projectId: job.projectId,
          },
          error,
        );
        await snapshotRefreshJobRepository.markJobFailed(
          job.id,
          sanitizeSnapshotRefreshError(error),
        );

        return false;
      }
    },
  };
}

export function createSnapshotRefreshTrigger({
  snapshotRefreshProcessor,
  pollIntervalMs = 1_000,
  logger = console.error,
}: {
  snapshotRefreshProcessor: SnapshotRefreshProcessor;
  pollIntervalMs?: number;
  logger?: (message: string, error?: unknown) => void;
}): SnapshotRefreshTrigger {
  let isRunning = false;
  let stopped = false;
  const intervalHandle = setInterval(() => {
    void drainQueue();
  }, pollIntervalMs);

  intervalHandle.unref?.();

  return {
    kick: () => {
      void drainQueue();
    },
    stop: () => {
      stopped = true;
      clearInterval(intervalHandle);
    },
  };

  async function drainQueue(): Promise<void> {
    if (stopped || isRunning) {
      return;
    }

    isRunning = true;

    try {
      while (!stopped) {
        const processedJob = await snapshotRefreshProcessor.processNextJob();

        if (!processedJob) {
          break;
        }
      }
    } catch (error) {
      logger("Snapshot refresh processor failed", error);
    } finally {
      isRunning = false;
    }
  }
}

function sanitizeSnapshotRefreshError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "snapshot refresh was aborted";
  }

  return "snapshot refresh failed; see logs for details";
}
