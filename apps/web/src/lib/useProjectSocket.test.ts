import { renderHook, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  FileTreeChangedEvent,
  SnapshotRestoredEvent,
} from "@collab-tex/shared";
import { useProjectSocket } from "./useProjectSocket";

const mockSocketOn = vi.fn();
const mockSocketOff = vi.fn();

vi.mock("@/lib/socket", () => ({
  getSocket: vi.fn(() => ({ on: mockSocketOn, off: mockSocketOff })),
}));

describe("useProjectSocket", () => {
  let refreshTree: () => Promise<void>;
  let onSnapshotRestored: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    refreshTree = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    onSnapshotRestored = vi.fn<() => void>();
  });

  afterEach(cleanup);

  it("registers listeners on mount and cleans up on unmount", () => {
    const { unmount } = renderHook(() =>
      useProjectSocket({
        projectId: "p1",
        refreshTree,
        onSnapshotRestored,
      }),
    );

    expect(mockSocketOn).toHaveBeenCalledWith(
      "project:tree_changed",
      expect.any(Function),
    );
    expect(mockSocketOn).toHaveBeenCalledWith(
      "snapshot:restored",
      expect.any(Function),
    );

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      "project:tree_changed",
      expect.any(Function),
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      "snapshot:restored",
      expect.any(Function),
    );
  });

  it("does not register listeners when projectId is undefined", () => {
    renderHook(() =>
      useProjectSocket({
        projectId: undefined,
        refreshTree,
        onSnapshotRestored,
      }),
    );

    expect(mockSocketOn).not.toHaveBeenCalled();
  });

  it("calls refreshTree on tree_changed for matching projectId", () => {
    renderHook(() =>
      useProjectSocket({
        projectId: "p1",
        refreshTree,
        onSnapshotRestored,
      }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "project:tree_changed",
    )![1] as (data: FileTreeChangedEvent) => void;

    handler({ projectId: "p1" });
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("ignores tree_changed events for non-matching projectId", () => {
    renderHook(() =>
      useProjectSocket({
        projectId: "p1",
        refreshTree,
        onSnapshotRestored,
      }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "project:tree_changed",
    )![1] as (data: FileTreeChangedEvent) => void;

    handler({ projectId: "other" });
    expect(refreshTree).not.toHaveBeenCalled();
  });

  it("calls onSnapshotRestored on snapshot:restored for matching projectId", () => {
    renderHook(() =>
      useProjectSocket({
        projectId: "p1",
        refreshTree,
        onSnapshotRestored,
      }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "snapshot:restored",
    )![1] as (data: SnapshotRestoredEvent) => void;

    handler({ projectId: "p1" });
    expect(onSnapshotRestored).toHaveBeenCalledTimes(1);
  });

  it("ignores snapshot:restored events for non-matching projectId", () => {
    renderHook(() =>
      useProjectSocket({
        projectId: "p1",
        refreshTree,
        onSnapshotRestored,
      }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "snapshot:restored",
    )![1] as (data: SnapshotRestoredEvent) => void;

    handler({ projectId: "other" });
    expect(onSnapshotRestored).not.toHaveBeenCalled();
  });
});
