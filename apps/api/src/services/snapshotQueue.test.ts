import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueueProjectSnapshot } from "./snapshotQueue.js";

import {
  hasRecentPendingJob,
  queueSnapshotRefreshJob,
} from "../repositories/snapshotRefreshJobRepository.js";

vi.mock("../repositories/snapshotRefreshJobRepository.js", () => ({
  hasRecentPendingJob: vi.fn().mockResolvedValue(false),
  queueSnapshotRefreshJob: vi.fn().mockResolvedValue(undefined),
}));

const mockedHasRecentPendingJob = vi.mocked(hasRecentPendingJob);
const mockedQueueSnapshotRefreshJob = vi.mocked(queueSnapshotRefreshJob);

function createMocks() {
  const databaseClient = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(databaseClient);
    }),
  };
  const snapshotRepository = {
    getLatestSnapshotTime: vi.fn().mockResolvedValue(null),
  };
  const snapshotRefreshTrigger = {
    kick: vi.fn(),
  };
  return { databaseClient, snapshotRepository, snapshotRefreshTrigger };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasRecentPendingJob.mockResolvedValue(false);
  mockedQueueSnapshotRefreshJob.mockResolvedValue(undefined);
});

describe("queueProjectSnapshot", () => {
  it("queues a job and kicks the trigger when no dedup conditions are met", async () => {
    const mocks = createMocks();
    const queueProjectSnapshot = createQueueProjectSnapshot(
      mocks as Parameters<typeof createQueueProjectSnapshot>[0],
    );

    await queueProjectSnapshot("project-1", "user-1");

    expect(mockedQueueSnapshotRefreshJob).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: "project-1", requestedByUserId: "user-1" },
    );
    expect(mocks.snapshotRefreshTrigger.kick).toHaveBeenCalled();
  });

  it("skips when a pending job already exists (checked inside transaction)", async () => {
    const mocks = createMocks();
    mockedHasRecentPendingJob.mockResolvedValue(true);
    const queueProjectSnapshot = createQueueProjectSnapshot(
      mocks as Parameters<typeof createQueueProjectSnapshot>[0],
    );

    await queueProjectSnapshot("project-1", "user-1");

    expect(mocks.databaseClient.$transaction).toHaveBeenCalled();
    expect(mockedQueueSnapshotRefreshJob).not.toHaveBeenCalled();
    expect(mocks.snapshotRefreshTrigger.kick).not.toHaveBeenCalled();
  });

  it("skips when the latest snapshot is within the minimum interval", async () => {
    const mocks = createMocks();
    mocks.snapshotRepository.getLatestSnapshotTime.mockResolvedValue(
      new Date(Date.now() - 10_000),
    );
    const queueProjectSnapshot = createQueueProjectSnapshot(
      mocks as Parameters<typeof createQueueProjectSnapshot>[0],
    );

    await queueProjectSnapshot("project-1", "user-1", 30_000);

    expect(mocks.databaseClient.$transaction).not.toHaveBeenCalled();
  });

  it("queues when the latest snapshot is older than the minimum interval", async () => {
    const mocks = createMocks();
    mocks.snapshotRepository.getLatestSnapshotTime.mockResolvedValue(
      new Date(Date.now() - 60_000),
    );
    const queueProjectSnapshot = createQueueProjectSnapshot(
      mocks as Parameters<typeof createQueueProjectSnapshot>[0],
    );

    await queueProjectSnapshot("project-1", "user-1", 30_000);

    expect(mockedQueueSnapshotRefreshJob).toHaveBeenCalled();
    expect(mocks.snapshotRefreshTrigger.kick).toHaveBeenCalled();
  });

  it("passes null userId for system-triggered snapshots", async () => {
    const mocks = createMocks();
    const queueProjectSnapshot = createQueueProjectSnapshot(
      mocks as Parameters<typeof createQueueProjectSnapshot>[0],
    );

    await queueProjectSnapshot("project-1", null);

    expect(mockedQueueSnapshotRefreshJob).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: "project-1", requestedByUserId: null },
    );
  });
});
