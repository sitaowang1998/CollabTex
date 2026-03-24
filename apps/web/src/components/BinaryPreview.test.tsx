import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api, ApiError } from "../lib/api";
import BinaryPreview from "./BinaryPreview";

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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("BinaryPreview", () => {
  it("shows image preview for image/* mime types", async () => {
    const blob = new Blob(["fake-image"], { type: "image/png" });
    mockedApi.getBlob.mockResolvedValue(blob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/image.png"
        mime="image/png"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "blob:fake-url");
    expect(img).toHaveAttribute("alt", "image.png");
  });

  it("shows filename and mime for non-image binary files", () => {
    render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/document.pdf"
        mime="application/pdf"
      />,
    );

    expect(screen.getByText("document.pdf")).toBeInTheDocument();
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
  });

  it("shows 'Binary file' when mime is null", () => {
    render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/unknown.bin"
        mime={null}
      />,
    );

    expect(screen.getByText("unknown.bin")).toBeInTheDocument();
    expect(screen.getByText("Binary file")).toBeInTheDocument();
  });

  it("shows loading state for images", () => {
    mockedApi.getBlob.mockReturnValue(new Promise(() => {}));

    render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/image.png"
        mime="image/png"
      />,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows error state with retry on fetch failure", async () => {
    const user = userEvent.setup();
    mockedApi.getBlob.mockRejectedValue(new ApiError(500, "Server error"));

    render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/image.png"
        mime="image/png"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    const blob = new Blob(["fake-image"], { type: "image/png" });
    mockedApi.getBlob.mockResolvedValue(blob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
  });

  it("calls the correct API endpoint", async () => {
    const blob = new Blob(["img"], { type: "image/png" });
    mockedApi.getBlob.mockResolvedValue(blob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/image.png"
        mime="image/png"
      />,
    );

    await waitFor(() => {
      expect(mockedApi.getBlob).toHaveBeenCalledWith(
        "/projects/p1/files/doc-1/content",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("revokes object URL on unmount", async () => {
    const blob = new Blob(["fake-image"], { type: "image/png" });
    mockedApi.getBlob.mockResolvedValue(blob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    const { unmount } = render(
      <BinaryPreview
        projectId="p1"
        documentId="doc-1"
        path="/image.png"
        mime="image/png"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-url");
  });
});
