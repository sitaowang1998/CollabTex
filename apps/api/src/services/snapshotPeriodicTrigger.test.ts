import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshotPeriodicTrigger } from "./snapshotPeriodicTrigger.js";

function createMocks() {
  return {
    activeDocumentRegistry: {
      getActiveProjectIds: vi.fn().mockReturnValue([] as string[]),
    },
    queueProjectSnapshot: vi.fn().mockResolvedValue(undefined),
  };
}

describe("snapshotPeriodicTrigger", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls queueProjectSnapshot for active projects on each poll", async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    mocks.activeDocumentRegistry.getActiveProjectIds.mockReturnValue([
      "p1",
      "p2",
    ]);
    const trigger = createSnapshotPeriodicTrigger({
      ...mocks,
      pollIntervalMs: 100,
      snapshotIntervalMs: 300_000,
    });

    try {
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.queueProjectSnapshot).toHaveBeenCalledWith(
        "p1",
        null,
        300_000,
      );
      expect(mocks.queueProjectSnapshot).toHaveBeenCalledWith(
        "p2",
        null,
        300_000,
      );
    } finally {
      trigger.stop();
    }
  });

  it("does not call queueProjectSnapshot when no projects are active", async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    mocks.activeDocumentRegistry.getActiveProjectIds.mockReturnValue([]);
    const trigger = createSnapshotPeriodicTrigger({
      ...mocks,
      pollIntervalMs: 100,
    });

    try {
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.queueProjectSnapshot).not.toHaveBeenCalled();
    } finally {
      trigger.stop();
    }
  });

  it("stops polling after stop() is called", async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    mocks.activeDocumentRegistry.getActiveProjectIds.mockReturnValue(["p1"]);
    const trigger = createSnapshotPeriodicTrigger({
      ...mocks,
      pollIntervalMs: 100,
    });

    trigger.stop();
    await vi.advanceTimersByTimeAsync(200);

    expect(mocks.queueProjectSnapshot).not.toHaveBeenCalled();
  });

  it("continues polling even if queueProjectSnapshot rejects", async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    mocks.activeDocumentRegistry.getActiveProjectIds.mockReturnValue(["p1"]);
    mocks.queueProjectSnapshot.mockRejectedValueOnce(new Error("db error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const trigger = createSnapshotPeriodicTrigger({
      ...mocks,
      pollIntervalMs: 100,
    });

    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(consoleSpy).toHaveBeenCalled();

      mocks.queueProjectSnapshot.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.queueProjectSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      trigger.stop();
      consoleSpy.mockRestore();
    }
  });
});
