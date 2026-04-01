import { renderHook, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CommentThread,
  CommentThreadCreatedEvent,
  CommentAddedEvent,
  CommentThreadStatusChangedEvent,
} from "@collab-tex/shared";
import { useCommentSocket } from "./useCommentSocket";

const mockSocketOn = vi.fn();
const mockSocketOff = vi.fn();

vi.mock("@/lib/socket", () => ({
  getSocket: vi.fn(() => ({ on: mockSocketOn, off: mockSocketOff })),
}));

const makeThread = (id: string): CommentThread => ({
  id,
  documentId: "d1",
  projectId: "p1",
  status: "open",
  startAnchor: "",
  endAnchor: "",
  quotedText: "text",
  comments: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("useCommentSocket", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.fn() mock needs to match hook's updater signature
  let setThreads: any;

  beforeEach(() => {
    vi.clearAllMocks();
    setThreads = vi.fn();
  });

  afterEach(cleanup);

  it("registers listeners on mount and cleans up on unmount", () => {
    const { unmount } = renderHook(() =>
      useCommentSocket({
        projectId: "p1",
        documentId: "d1",
        setThreads,
      }),
    );

    expect(mockSocketOn).toHaveBeenCalledWith(
      "comment:thread_created",
      expect.any(Function),
    );
    expect(mockSocketOn).toHaveBeenCalledWith(
      "comment:added",
      expect.any(Function),
    );
    expect(mockSocketOn).toHaveBeenCalledWith(
      "comment:thread_status_changed",
      expect.any(Function),
    );

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      "comment:thread_created",
      expect.any(Function),
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      "comment:added",
      expect.any(Function),
    );
    expect(mockSocketOff).toHaveBeenCalledWith(
      "comment:thread_status_changed",
      expect.any(Function),
    );
  });

  it("does not register listeners when projectId is undefined", () => {
    renderHook(() =>
      useCommentSocket({
        projectId: undefined,
        documentId: "d1",
        setThreads,
      }),
    );

    expect(mockSocketOn).not.toHaveBeenCalled();
  });

  it("does not register listeners when documentId is undefined", () => {
    renderHook(() =>
      useCommentSocket({
        projectId: "p1",
        documentId: undefined,
        setThreads,
      }),
    );

    expect(mockSocketOn).not.toHaveBeenCalled();
  });

  it("adds new thread on thread_created", () => {
    const thread = makeThread("t1");
    renderHook(() =>
      useCommentSocket({ projectId: "p1", documentId: "d1", setThreads }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "comment:thread_created",
    )![1] as (data: CommentThreadCreatedEvent) => void;

    act(() => handler({ projectId: "p1", documentId: "d1", thread }));

    const updater = setThreads.mock.calls[0][0] as (
      prev: CommentThread[],
    ) => CommentThread[];
    expect(updater([])).toEqual([thread]);
  });

  it("deduplicates thread on thread_created", () => {
    const thread = makeThread("t1");
    renderHook(() =>
      useCommentSocket({ projectId: "p1", documentId: "d1", setThreads }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "comment:thread_created",
    )![1] as (data: CommentThreadCreatedEvent) => void;

    act(() => handler({ projectId: "p1", documentId: "d1", thread }));

    const updater = setThreads.mock.calls[0][0] as (
      prev: CommentThread[],
    ) => CommentThread[];
    expect(updater([thread])).toEqual([thread]);
  });

  it("ignores thread_created for non-matching projectId", () => {
    const thread = makeThread("t1");
    renderHook(() =>
      useCommentSocket({ projectId: "p1", documentId: "d1", setThreads }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "comment:thread_created",
    )![1] as (data: CommentThreadCreatedEvent) => void;

    act(() => handler({ projectId: "other", documentId: "d1", thread }));
    expect(setThreads).not.toHaveBeenCalled();
  });

  it("ignores thread_created for non-matching documentId", () => {
    const thread = makeThread("t1");
    renderHook(() =>
      useCommentSocket({ projectId: "p1", documentId: "d1", setThreads }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "comment:thread_created",
    )![1] as (data: CommentThreadCreatedEvent) => void;

    act(() => handler({ projectId: "p1", documentId: "other", thread }));
    expect(setThreads).not.toHaveBeenCalled();
  });

  it("adds comment to correct thread on comment:added", () => {
    const thread: CommentThread = { ...makeThread("t1"), comments: [] };
    const comment = {
      id: "c1",
      threadId: "t1",
      authorId: "user1",
      body: "hello",
      authorName: "Alice",
      createdAt: new Date().toISOString(),
    };

    renderHook(() =>
      useCommentSocket({ projectId: "p1", documentId: "d1", setThreads }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "comment:added",
    )![1] as (data: CommentAddedEvent) => void;

    act(() =>
      handler({ projectId: "p1", documentId: "d1", threadId: "t1", comment }),
    );

    const updater = setThreads.mock.calls[0][0] as (
      prev: CommentThread[],
    ) => CommentThread[];
    const result = updater([thread]);
    expect(result[0].comments).toEqual([comment]);
  });

  it("updates thread status on thread_status_changed", () => {
    const thread = makeThread("t1");
    renderHook(() =>
      useCommentSocket({ projectId: "p1", documentId: "d1", setThreads }),
    );

    const handler = mockSocketOn.mock.calls.find(
      ([event]) => event === "comment:thread_status_changed",
    )![1] as (data: CommentThreadStatusChangedEvent) => void;

    act(() =>
      handler({
        projectId: "p1",
        documentId: "d1",
        threadId: "t1",
        status: "resolved",
      }),
    );

    const updater = setThreads.mock.calls[0][0] as (
      prev: CommentThread[],
    ) => CommentThread[];
    const result = updater([thread]);
    expect(result[0].status).toBe("resolved");
  });
});
