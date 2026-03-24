import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectDocumentContentResponse } from "@collab-tex/shared";
import { api, ApiError } from "../lib/api";
import Editor from "./Editor";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ApiError: actual.ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const contentResponse: ProjectDocumentContentResponse = {
  document: {
    id: "doc-1",
    path: "/main.tex",
    kind: "text",
    mime: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  content:
    "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Editor", () => {
  it("shows loading state initially", () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));
    render(<Editor projectId="p1" path="/main.tex" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("displays file content after fetch", async () => {
    mockedApi.get.mockResolvedValue(contentResponse);
    render(<Editor projectId="p1" path="/main.tex" />);

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });

    expect(document.querySelector(".cm-content")?.textContent).toContain(
      "\\documentclass{article}",
    );
  });

  it("shows error state on fetch failure with retry button", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server error"));
    render(<Editor projectId="p1" path="/main.tex" />);

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    mockedApi.get.mockResolvedValue(contentResponse);
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByText("Server error")).not.toBeInTheDocument();
    });
  });

  it("handles null content as empty document", async () => {
    mockedApi.get.mockResolvedValue({
      ...contentResponse,
      content: null,
    });
    render(<Editor projectId="p1" path="/main.tex" />);

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
  });

  it("replaces content when path changes", async () => {
    mockedApi.get.mockResolvedValue(contentResponse);
    const { rerender } = render(<Editor projectId="p1" path="/main.tex" />);

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    const secondResponse: ProjectDocumentContentResponse = {
      document: {
        ...contentResponse.document,
        id: "doc-2",
        path: "/other.tex",
      },
      content: "Second file content",
    };
    mockedApi.get.mockResolvedValue(secondResponse);

    rerender(<Editor projectId="p1" path="/other.tex" />);

    await waitFor(() => {
      expect(document.querySelector(".cm-content")?.textContent).toContain(
        "Second file content",
      );
    });
  });

  it("calls the correct API endpoint", async () => {
    mockedApi.get.mockResolvedValue(contentResponse);
    render(<Editor projectId="p1" path="/main.tex" />);

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalledWith(
        "/projects/p1/files/content?path=%2Fmain.tex",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("shows error message for non-ApiError exceptions", async () => {
    mockedApi.get.mockRejectedValue(new Error("network down"));
    render(<Editor projectId="p1" path="/main.tex" />);

    await waitFor(() => {
      expect(screen.getByText("network down")).toBeInTheDocument();
    });
  });
});
