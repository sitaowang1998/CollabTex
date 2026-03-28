import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompileDoneEvent } from "@collab-tex/shared";
import { api, ApiError } from "../lib/api";

type CompileDoneHandler = (data: CompileDoneEvent) => void;

let compileDoneHandler: CompileDoneHandler | null = null;
const mockSocketOn = vi.fn((event: string, handler: CompileDoneHandler) => {
  if (event === "compile:done") compileDoneHandler = handler;
});
const mockSocketOff = vi.fn();

vi.mock("../lib/socket", () => ({
  getSocket: vi.fn(() => ({
    on: mockSocketOn,
    off: mockSocketOff,
  })),
}));

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

const mockRenderPromise = Promise.resolve();
const mockGetPage = vi.fn().mockResolvedValue({
  getViewport: () => ({ width: 612, height: 792 }),
  render: () => ({ promise: mockRenderPromise }),
});
const mockPdfDoc = {
  numPages: 1,
  getPage: mockGetPage,
  destroy: vi.fn(),
};

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve(mockPdfDoc),
  }),
}));

const mockedApi = vi.mocked(api);

// Must import after mocks
const { default: PdfPreview } = await import("./PdfPreview");

beforeEach(() => {
  vi.resetAllMocks();
  compileDoneHandler = null;
  mockGetPage.mockResolvedValue({
    getViewport: () => ({ width: 612, height: 792 }),
    render: () => ({ promise: mockRenderPromise }),
  });
});

function createPdfBlob() {
  return new Blob(["pdf-content"], { type: "application/pdf" });
}

describe("PdfPreview", () => {
  it("shows loading state while fetching initial PDF", () => {
    mockedApi.getBlob.mockReturnValue(new Promise(() => {}));
    render(<PdfPreview projectId="p1" role="editor" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("displays PDF canvas container when PDF loads successfully", async () => {
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });
  });

  it("shows 'No compiled PDF' when initial fetch returns 404", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByText("No compiled PDF. Click Compile to build."),
      ).toBeInTheDocument();
    });
  });

  it("shows compile button for admin role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="admin" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });
  });

  it("shows compile button for editor role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });
  });

  it("hides compile button for reader role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="reader" />);

    await waitFor(() => {
      expect(screen.getByText("No compiled PDF yet.")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Compile" }),
    ).not.toBeInTheDocument();
  });

  it("hides compile button for commenter role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="commenter" />);

    await waitFor(() => {
      expect(screen.getByText("No compiled PDF yet.")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Compile" }),
    ).not.toBeInTheDocument();
  });

  it("calls POST endpoint and shows compiling state when Compile clicked", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockReturnValue(new Promise(() => {})); // never resolves

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    expect(mockedApi.post).toHaveBeenCalledWith(`/projects/p1/compile`);
    expect(screen.getByRole("button", { name: "Compiling…" })).toBeDisabled();
  });

  it("shows 'Compile already in progress' on 409", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockRejectedValue(new ApiError(409, "Conflict"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(
        screen.getByText("Compile already in progress"),
      ).toBeInTheDocument();
    });
  });

  it("displays error logs on compile failure", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockResolvedValue({
      status: "failure",
      logs: "! LaTeX Error: File not found.",
    });

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(
        screen.getByText("! LaTeX Error: File not found."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Compile logs:")).toBeInTheDocument();
  });

  it("handles compile:done socket event for success", async () => {
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(createPdfBlob());

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(compileDoneHandler).not.toBeNull();
    });

    await waitFor(() => {
      expect(
        screen.getByText("No compiled PDF. Click Compile to build."),
      ).toBeInTheDocument();
    });

    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "success",
        logs: "",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });
  });

  it("handles compile:done socket event for failure", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByText("No compiled PDF. Click Compile to build."),
      ).toBeInTheDocument();
    });

    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "failure",
        logs: "Undefined control sequence.",
      });
    });

    expect(screen.getByText("Undefined control sequence.")).toBeInTheDocument();
  });

  it("ignores compile:done for different projectId", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByText("No compiled PDF. Click Compile to build."),
      ).toBeInTheDocument();
    });

    await act(async () => {
      compileDoneHandler!({
        projectId: "p2",
        status: "failure",
        logs: "Some error",
      });
    });

    expect(
      screen.getByText("No compiled PDF. Click Compile to build."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Some error")).not.toBeInTheDocument();
  });

  it("removes socket listener on unmount", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    const { unmount } = render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(mockSocketOn).toHaveBeenCalledWith(
        "compile:done",
        expect.any(Function),
      );
    });

    unmount();

    expect(mockSocketOff).toHaveBeenCalledWith(
      "compile:done",
      expect.any(Function),
    );
  });

  it("fetches PDF and displays after successful compile via button", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(createPdfBlob());
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });
  });

  it("shows error for generic (non-409) compile API error", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockRejectedValue(
      new ApiError(500, "Internal server error"),
    );

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByText("Internal server error")).toBeInTheDocument();
    });
  });

  it("shows 'Compile failed' for non-ApiError compile error", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockRejectedValue(new Error("Network error"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByText("Compile failed")).toBeInTheDocument();
    });
  });

  it("shows specific error when compile succeeds but PDF fetch fails", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockRejectedValueOnce(new ApiError(500, "Storage error"));
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Compile succeeded but failed to load PDF: Storage error",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows error when initial fetch returns non-404 error", async () => {
    mockedApi.getBlob.mockRejectedValue(
      new ApiError(500, "Internal server error"),
    );

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(screen.getByText("Internal server error")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("re-enables compile button after 409 error", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockRejectedValue(new ApiError(409, "Conflict"));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(
        screen.getByText("Compile already in progress"),
      ).toBeInTheDocument();
    });

    const button = screen.getByRole("button", { name: "Compile" });
    expect(button).not.toBeDisabled();
  });

  it("shows error when compile succeeds but fetchPdf returns 404 (no PDF available)", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(
        screen.getByText("Compile succeeded but no PDF is available"),
      ).toBeInTheDocument();
    });
  });
});
