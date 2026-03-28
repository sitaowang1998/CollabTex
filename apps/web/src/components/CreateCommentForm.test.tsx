import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api, ApiError } from "../lib/api";

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

const { default: CreateCommentForm } = await import("./CreateCommentForm");

const selection = {
  startAnchorB64: "c3RhcnQ=",
  endAnchorB64: "ZW5k",
  quotedText: "Hello World",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CreateCommentForm", () => {
  it("shows the quoted text", () => {
    render(
      <CreateCommentForm
        projectId="p1"
        documentId="d1"
        selection={selection}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("submit button is disabled when body is empty", () => {
    render(
      <CreateCommentForm
        projectId="p1"
        documentId="d1"
        selection={selection}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("submits with correct payload", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mockedApi.post.mockResolvedValue({ thread: { id: "t1" } });

    render(
      <CreateCommentForm
        projectId="p1"
        documentId="d1"
        selection={selection}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Comment body"), "My comment");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/projects/p1/docs/d1/comments",
      {
        startAnchorB64: "c3RhcnQ=",
        endAnchorB64: "ZW5k",
        quotedText: "Hello World",
        body: "My comment",
      },
    );
  });

  it("shows error on failure", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValue(new ApiError(400, "Bad request"));

    render(
      <CreateCommentForm
        projectId="p1"
        documentId="d1"
        selection={selection}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Comment body"), "My comment");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText("Bad request")).toBeInTheDocument();
    });
  });

  it("cancel calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <CreateCommentForm
        projectId="p1"
        documentId="d1"
        selection={selection}
        onCreated={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
