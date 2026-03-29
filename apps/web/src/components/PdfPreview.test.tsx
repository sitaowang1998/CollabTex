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

function setupDownloadMocks() {
  const createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/fake");
  const revokeObjectURL = vi.fn();
  globalThis.URL.createObjectURL = createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL;

  const anchorProps: Record<string, unknown> = {};
  const clickSpy = vi.fn();
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "a") {
      const anchor = new Proxy(
        { click: clickSpy },
        {
          set(target, prop, value) {
            anchorProps[prop as string] = value;
            return Reflect.set(target, prop, value);
          },
        },
      ) as unknown as HTMLAnchorElement;
      return anchor;
    }
    return document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElement;
  });

  return { anchorProps, clickSpy, createObjectURL, revokeObjectURL };
}

describe("PdfPreview", () => {
  it("shows loading state while fetching initial PDF", () => {
    mockedApi.getBlob.mockReturnValue(new Promise(() => {}));
    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("displays PDF canvas container when PDF loads successfully", async () => {
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });
  });

  it("shows 'No compiled PDF' when initial fetch returns 404", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No compiled PDF. Click Compile to build."),
      ).toBeInTheDocument();
    });
  });

  it("shows compile button for admin role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(<PdfPreview projectId="p1" projectName="My Project" role="admin" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });
  });

  it("shows compile button for editor role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });
  });

  it("hides compile button for reader role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="reader" />,
    );

    await waitFor(() => {
      expect(screen.getByText("No compiled PDF yet.")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Compile" }),
    ).not.toBeInTheDocument();
  });

  it("hides compile button for commenter role", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="commenter" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    const { unmount } = render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(screen.getByText("Internal server error")).toBeInTheDocument();
    });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("re-enables compile button after 409 error", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockRejectedValue(new ApiError(409, "Conflict"));

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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

  it("does not show download button when no PDF is loaded", async () => {
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No compiled PDF. Click Compile to build."),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();
  });

  it("shows download button when PDF is loaded", async () => {
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });
  });

  it("triggers download when download button is clicked", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps, clickSpy, createObjectURL, revokeObjectURL } =
      setupDownloadMocks();

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/pdf" }),
    );
    expect(anchorProps.download).toBe("My Project.pdf");
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/fake");

    vi.restoreAllMocks();
  });

  it("sanitizes special characters in download filename", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();

    render(
      <PdfPreview
        projectId="p1"
        projectName='test/proj:2"file'
        role="editor"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe("test_proj_2_file.pdf");

    vi.restoreAllMocks();
  });

  it("uses fallback filename when projectName is all special characters", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();

    render(<PdfPreview projectId="p1" projectName='/:*?"' role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe("output.pdf");

    vi.restoreAllMocks();
  });

  it("uses fallback filename when projectName is empty", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();

    render(<PdfPreview projectId="p1" projectName="" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe("output.pdf");

    vi.restoreAllMocks();
  });

  it("strips leading and trailing special characters from filename", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();

    render(
      <PdfPreview projectId="p1" projectName="/My Project/" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe("My Project.pdf");

    vi.restoreAllMocks();
  });

  it("truncates very long project names in download filename", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();
    const longName = "A".repeat(300);

    render(<PdfPreview projectId="p1" projectName={longName} role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe(`${"A".repeat(200)}.pdf`);

    vi.restoreAllMocks();
  });

  it("uses fallback filename for dot-only project names", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();

    render(<PdfPreview projectId="p1" projectName="..." role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe("output.pdf");

    vi.restoreAllMocks();
  });

  it("strips control characters from download filename", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());
    const { anchorProps } = setupDownloadMocks();

    render(
      <PdfPreview
        projectId="p1"
        projectName={"My\x00Project\nName"}
        role="editor"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(anchorProps.download).toBe("MyProjectName.pdf");

    vi.restoreAllMocks();
  });

  it("shows error when download fails", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockResolvedValue(createPdfBlob());

    const createObjectURL = vi.fn().mockImplementation(() => {
      throw new Error("SecurityError");
    });
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = vi.fn();

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /download/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(screen.getByText("Failed to download PDF")).toBeInTheDocument();

    vi.restoreAllMocks();
  });

  it("download button persists after failed recompile", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(createPdfBlob())
      .mockRejectedValueOnce(new ApiError(404, "Not found"));
    mockedApi.post
      .mockResolvedValueOnce({ status: "success", logs: "" })
      .mockResolvedValueOnce({ status: "failure", logs: "Error" });

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    // First compile succeeds
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();

    // Second compile fails
    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByText("Compile logs:")).toBeInTheDocument();
    });

    // Download button should still be visible
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("keeps only the last queued socket event during active compile", async () => {
    const user = userEvent.setup();
    let resolvePost: (value: unknown) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValue(createPdfBlob());
    mockedApi.post.mockReturnValue(postPromise);

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    // Fire two socket events during active compile
    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "success",
        logs: "",
      });
    });

    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "failure",
        logs: "Second event wins",
      });
    });

    // Resolve the compile
    await act(async () => {
      resolvePost!({ status: "success", logs: "" });
    });

    // Only the last event should be reflected
    await waitFor(() => {
      expect(screen.getByText("Second event wins")).toBeInTheDocument();
    });
  });

  it("shows download button after successful compile", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(createPdfBlob());
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    // No download button before compile
    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });

    // Download button appears after successful compile
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("does not flash error when compile:done fires during active handleCompile", async () => {
    const user = userEvent.setup();
    let resolvePost: (value: unknown) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValue(createPdfBlob());
    mockedApi.post.mockReturnValue(postPromise);

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    // Socket event fires while handleCompile is still waiting for POST
    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "success",
        logs: "",
      });
    });

    // Resolve the POST
    await act(async () => {
      resolvePost!({ status: "success", logs: "" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });

    // The error should never have appeared
    expect(
      screen.queryByText("Compile reported success but no PDF is available"),
    ).not.toBeInTheDocument();
  });

  it("processes compile:done after handleCompile completes", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(createPdfBlob());
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    // Complete a compile cycle
    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-canvas-container")).toBeInTheDocument();
    });

    // Now fire a socket event after compile finishes — should be processed
    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "failure",
        logs: "Later error from another user",
      });
    });

    expect(
      screen.getByText("Later error from another user"),
    ).toBeInTheDocument();
  });

  it("queues compile:done failure during active compile and processes after", async () => {
    const user = userEvent.setup();
    let resolvePost: (value: unknown) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValue(createPdfBlob());
    mockedApi.post.mockReturnValue(postPromise);

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    // Another user's compile fails while our compile is in flight
    await act(async () => {
      compileDoneHandler!({
        projectId: "p1",
        status: "failure",
        logs: "Other user compile error",
      });
    });

    // Should not show yet — queued
    expect(
      screen.queryByText("Other user compile error"),
    ).not.toBeInTheDocument();

    // Resolve our compile
    await act(async () => {
      resolvePost!({ status: "success", logs: "" });
    });

    // Queued event should now be processed
    await waitFor(() => {
      expect(screen.getByText("Other user compile error")).toBeInTheDocument();
    });
  });

  it("shows error when compile succeeds but fetchPdf returns 404 (no PDF available)", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(
      <PdfPreview projectId="p1" projectName="My Project" role="editor" />,
    );

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
