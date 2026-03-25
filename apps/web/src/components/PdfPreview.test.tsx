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

const mockedApi = vi.mocked(api);

// Must import after mocks
const { default: PdfPreview } = await import("./PdfPreview");

beforeEach(() => {
  vi.resetAllMocks();
  compileDoneHandler = null;
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-pdf-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("PdfPreview", () => {
  it("shows loading state while fetching initial PDF", () => {
    mockedApi.getBlob.mockReturnValue(new Promise(() => {}));
    render(<PdfPreview projectId="p1" role="editor" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("displays PDF iframe when initial PDF loads successfully", async () => {
    const blob = new Blob(["pdf-content"], { type: "application/pdf" });
    mockedApi.getBlob.mockResolvedValue(blob);

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(screen.getByTitle("PDF preview")).toBeInTheDocument();
    });

    const iframe = screen.getByTitle("PDF preview");
    expect(iframe).toHaveAttribute("src", "blob:fake-pdf-url");
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
      .mockResolvedValueOnce(new Blob(["pdf"], { type: "application/pdf" }));

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(compileDoneHandler).not.toBeNull();
    });

    // Wait for initial load to finish
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
      expect(screen.getByTitle("PDF preview")).toBeInTheDocument();
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

    // Should still show the no-PDF message, not failure logs
    expect(
      screen.getByText("No compiled PDF. Click Compile to build."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Some error")).not.toBeInTheDocument();
  });

  it("revokes blob URL on unmount", async () => {
    const blob = new Blob(["pdf-content"], { type: "application/pdf" });
    mockedApi.getBlob.mockResolvedValue(blob);
    const revokeSpy = vi.mocked(URL.revokeObjectURL);

    const { unmount } = render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(screen.getByTitle("PDF preview")).toBeInTheDocument();
    });

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-pdf-url");
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
    const pdfBlob = new Blob(["pdf"], { type: "application/pdf" });
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockResolvedValueOnce(pdfBlob);
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Compile" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByTitle("PDF preview")).toBeInTheDocument();
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

  it("shows error when compile:done success but fetchPdf fails", async () => {
    mockedApi.getBlob
      .mockRejectedValueOnce(new ApiError(404, "Not found"))
      .mockRejectedValueOnce(new ApiError(500, "Server error"));

    render(<PdfPreview projectId="p1" role="editor" />);

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
      expect(screen.getByText("Server error")).toBeInTheDocument();
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
    // Should exit loading state
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("revokes old blob URL when recompiling produces new PDF", async () => {
    const user = userEvent.setup();
    const revokeSpy = vi.mocked(URL.revokeObjectURL);
    const createSpy = vi.mocked(URL.createObjectURL);
    createSpy
      .mockReturnValueOnce("blob:first-pdf")
      .mockReturnValueOnce("blob:second-pdf");

    const blob1 = new Blob(["pdf1"], { type: "application/pdf" });
    const blob2 = new Blob(["pdf2"], { type: "application/pdf" });
    mockedApi.getBlob
      .mockResolvedValueOnce(blob1) // initial load
      .mockResolvedValueOnce(blob2); // after recompile
    mockedApi.post.mockResolvedValue({ status: "success", logs: "" });

    render(<PdfPreview projectId="p1" role="editor" />);

    await waitFor(() => {
      expect(screen.getByTitle("PDF preview")).toHaveAttribute(
        "src",
        "blob:first-pdf",
      );
    });

    await user.click(screen.getByRole("button", { name: "Compile" }));

    await waitFor(() => {
      expect(screen.getByTitle("PDF preview")).toHaveAttribute(
        "src",
        "blob:second-pdf",
      );
    });

    expect(revokeSpy).toHaveBeenCalledWith("blob:first-pdf");
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

    // Button should be re-enabled with "Compile" text
    const button = screen.getByRole("button", { name: "Compile" });
    expect(button).not.toBeDisabled();
  });

  it("shows error when compile succeeds but fetchPdf returns 404 (no PDF available)", async () => {
    const user = userEvent.setup();
    // Initial load: 404 (no PDF yet). After compile: still 404.
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

  it("shows error when compile:done success but fetchPdf returns 404 (no PDF available)", async () => {
    // Both initial and post-socket fetch return 404
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
        status: "success",
        logs: "",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Compile reported success but no PDF is available"),
      ).toBeInTheDocument();
    });
  });
});
