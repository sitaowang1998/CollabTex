import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommentThread } from "@collab-tex/shared";
import { api } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ApiError: actual.ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      put: vi.fn(),
      getBlob: vi.fn(),
      uploadFile: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const { default: CommentPanel } = await import("./CommentPanel");

const baseThread: CommentThread = {
  id: "t1",
  documentId: "d1",
  projectId: "p1",
  status: "open",
  startAnchor: "abc",
  endAnchor: "def",
  quotedText: "selected text",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  comments: [
    {
      id: "c1",
      threadId: "t1",
      authorId: "user-1",
      authorName: "Test User",
      body: "This looks wrong",
      createdAt: new Date().toISOString(),
    },
  ],
};

const defaultProps = {
  projectId: "p1",
  documentId: "d1",
  role: "editor" as const,
  threads: [] as CommentThread[],
  isLoading: false,
  error: "",
  onRetry: vi.fn(),
  onMutated: vi.fn(),
  pendingSelection: null,
  onClearSelection: vi.fn(),
  threadPositions: new Map<string, number>(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CommentPanel", () => {
  it("shows loading state", () => {
    render(<CommentPanel {...defaultProps} isLoading={true} />);
    expect(screen.getByText("Loading comments…")).toBeInTheDocument();
  });

  it("displays threads with quoted text, status, and comments", () => {
    render(<CommentPanel {...defaultProps} threads={[baseThread]} />);
    expect(screen.getAllByText("selected text").length).toBeGreaterThan(0);
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("This looks wrong")).toBeInTheDocument();
    expect(screen.getByText(/Test User/)).toBeInTheDocument();
  });

  it("shows empty state when no threads", () => {
    render(<CommentPanel {...defaultProps} />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const onRetry = vi.fn();
    render(
      <CommentPanel {...defaultProps} error="Server error" onRetry={onRetry} />,
    );
    expect(screen.getByText("Server error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("calls onRetry when retry is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <CommentPanel {...defaultProps} error="Server error" onRetry={onRetry} />,
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("submits reply and calls onMutated", async () => {
    const user = userEvent.setup();
    const onMutated = vi.fn();
    mockedApi.post.mockResolvedValue({
      comment: {
        id: "c2",
        threadId: "t1",
        authorId: "u1",
        authorName: "Reply User",
        body: "Reply",
        createdAt: new Date().toISOString(),
      },
    });

    render(
      <CommentPanel
        {...defaultProps}
        threads={[baseThread]}
        onMutated={onMutated}
      />,
    );

    const replyInput = screen.getByLabelText("Reply");
    await user.type(replyInput, "My reply");
    await user.click(screen.getByRole("button", { name: "Reply" }));

    expect(mockedApi.post).toHaveBeenCalledWith(
      "/projects/p1/threads/t1/reply",
      { body: "My reply" },
    );
    await waitFor(() => {
      expect(onMutated).toHaveBeenCalled();
    });
  });

  it("resolve button calls onMutated", async () => {
    const user = userEvent.setup();
    const onMutated = vi.fn();
    mockedApi.patch.mockResolvedValue(undefined);

    render(
      <CommentPanel
        {...defaultProps}
        threads={[baseThread]}
        onMutated={onMutated}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Resolve" }));

    expect(mockedApi.patch).toHaveBeenCalledWith("/projects/p1/threads/t1", {
      status: "resolved",
    });
    await waitFor(() => {
      expect(onMutated).toHaveBeenCalled();
    });
  });

  it("shows reply error on failed reply", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValue(new Error("Network error"));

    render(<CommentPanel {...defaultProps} threads={[baseThread]} />);

    const replyInput = screen.getByLabelText("Reply");
    await user.type(replyInput, "My reply");
    await user.click(screen.getByRole("button", { name: "Reply" }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("shows Reopen for resolved threads", () => {
    const resolvedThread = { ...baseThread, status: "resolved" as const };
    render(<CommentPanel {...defaultProps} threads={[resolvedThread]} />);
    expect(screen.getByText("Reopen")).toBeInTheDocument();
  });

  it("resolved threads are collapsed by default", () => {
    const resolvedThread = { ...baseThread, status: "resolved" as const };
    render(<CommentPanel {...defaultProps} threads={[resolvedThread]} />);
    // The quoted blockquote (full) should not be visible since collapsed
    // but the truncated text in the header should be
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();
  });

  it("readers cannot see reply form or resolve button", () => {
    render(
      <CommentPanel {...defaultProps} role="reader" threads={[baseThread]} />,
    );
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve" }),
    ).not.toBeInTheDocument();
  });

  it("shows CreateCommentForm when pendingSelection is provided", () => {
    render(
      <CommentPanel
        {...defaultProps}
        pendingSelection={{
          startAnchorB64: "c3RhcnQ=",
          endAnchorB64: "ZW5k",
          quotedText: "quoted stuff",
        }}
      />,
    );
    expect(screen.getByTestId("create-comment-form")).toBeInTheDocument();
    expect(screen.getByText("quoted stuff")).toBeInTheDocument();
  });

  it("clears selection and calls onMutated after creating a thread", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onMutated = vi.fn();
    mockedApi.post.mockResolvedValue({
      thread: { ...baseThread, quotedText: "quoted stuff" },
    });

    render(
      <CommentPanel
        {...defaultProps}
        onClearSelection={onClear}
        onMutated={onMutated}
        pendingSelection={{
          startAnchorB64: "c3RhcnQ=",
          endAnchorB64: "ZW5k",
          quotedText: "quoted stuff",
        }}
      />,
    );

    await user.type(screen.getByLabelText("Comment body"), "New comment");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(onClear).toHaveBeenCalled();
    });
    expect(onMutated).toHaveBeenCalled();
  });

  it("sorts threads by position", () => {
    const thread2 = {
      ...baseThread,
      id: "t2",
      quotedText: "earlier text",
      comments: [
        {
          ...baseThread.comments[0],
          id: "c2",
          threadId: "t2",
          body: "Earlier comment",
        },
      ],
    };
    const positions = new Map([
      ["t1", 50],
      ["t2", 10],
    ]);

    render(
      <CommentPanel
        {...defaultProps}
        threads={[baseThread, thread2]}
        threadPositions={positions}
      />,
    );

    const threadElements = screen.getAllByTestId("comment-thread");
    // thread2 (pos 10) should come before baseThread (pos 50)
    expect(threadElements[0]).toHaveTextContent("earlier text");
    expect(threadElements[1]).toHaveTextContent("selected text");
  });
});
