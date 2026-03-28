import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { YjsDocumentSyncOptions } from "../lib/yjs-sync";
import Editor from "./Editor";

vi.mock("../lib/socket", () => ({
  getSocket: vi.fn(() => ({})),
}));

let capturedOnSynced: (() => void) | null = null;
let capturedOnError: ((err: { code: string; message: string }) => void) | null =
  null;
let mockDoc: Y.Doc;
let mockAwareness: Awareness;
const mockDestroy = vi.fn();

vi.mock("../lib/yjs-sync", () => {
  return {
    YjsDocumentSync: vi.fn().mockImplementation(function (
      this: Record<string, unknown>,
      options: YjsDocumentSyncOptions,
    ) {
      capturedOnSynced = options.onSynced;
      capturedOnError = options.onError;
      this.doc = mockDoc;
      this.awareness = mockAwareness;
      this.isSynced = false;
      this.serverVersion = 0;
      this.destroy = mockDestroy;
    }),
  };
});

// Import after mock setup
const { YjsDocumentSync } = await import("../lib/yjs-sync");
const MockYjsDocumentSync = vi.mocked(YjsDocumentSync);

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnSynced = null;
  capturedOnError = null;
  mockDoc = new Y.Doc();
  mockAwareness = new Awareness(mockDoc);
});

afterEach(() => {
  mockAwareness.destroy();
  mockDoc.destroy();
});

describe("Editor", () => {
  it("shows loading state initially", () => {
    render(
      <Editor projectId="p1" documentId="d1" path="/main.tex" role="editor" />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("creates YjsDocumentSync with correct params", () => {
    render(
      <Editor projectId="p1" documentId="d1" path="/main.tex" role="editor" />,
    );

    expect(MockYjsDocumentSync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        documentId: "d1",
      }),
    );
  });

  it("renders editor container after sync", async () => {
    render(
      <Editor projectId="p1" documentId="d1" path="/main.tex" role="editor" />,
    );

    act(() => {
      capturedOnSynced?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });
  });

  it("shows error state with retry button", async () => {
    const user = userEvent.setup();

    render(
      <Editor projectId="p1" documentId="d1" path="/main.tex" role="editor" />,
    );

    act(() => {
      capturedOnError?.({ code: "FORBIDDEN", message: "No access" });
    });

    await waitFor(() => {
      expect(screen.getByText("No access")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Click retry should recreate sync
    await user.click(retryBtn);

    expect(MockYjsDocumentSync).toHaveBeenCalledTimes(2);
  });

  it("destroys sync on unmount", () => {
    const { unmount } = render(
      <Editor projectId="p1" documentId="d1" path="/main.tex" role="editor" />,
    );

    unmount();

    expect(mockDestroy).toHaveBeenCalled();
  });

  it("renders editor container for non-LaTeX file (plain text fallback)", async () => {
    render(
      <Editor projectId="p1" documentId="d1" path="/readme.md" role="editor" />,
    );

    act(() => {
      capturedOnSynced?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });
  });

  it("shows fallback error message when errorMessage is null", async () => {
    render(
      <Editor projectId="p1" documentId="d1" path="/main.tex" role="editor" />,
    );

    act(() => {
      capturedOnError?.({ code: "UNAVAILABLE", message: "" });
    });

    await waitFor(() => {
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
    });
  });

  it("renders with onCommentSelection prop without error", async () => {
    const onCommentSelection = vi.fn();
    render(
      <Editor
        projectId="p1"
        documentId="d1"
        path="/main.tex"
        role="editor"
        onCommentSelection={onCommentSelection}
      />,
    );

    act(() => {
      capturedOnSynced?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });
  });

  it("accepts commentThreads prop without error", async () => {
    render(
      <Editor
        projectId="p1"
        documentId="d1"
        path="/main.tex"
        role="editor"
        onCommentSelection={vi.fn()}
        commentThreads={[]}
        onThreadPositionsChange={vi.fn()}
      />,
    );

    act(() => {
      capturedOnSynced?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });
  });

  it("does not show Add Comment button for reader role", async () => {
    render(
      <Editor
        projectId="p1"
        documentId="d1"
        path="/main.tex"
        role="reader"
        onCommentSelection={vi.fn()}
      />,
    );

    act(() => {
      capturedOnSynced?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("add-comment-btn")).not.toBeInTheDocument();
  });
});
