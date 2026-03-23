import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import CreateProjectModal from "./CreateProjectModal";

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
    },
  };
});

const mockedApi = vi.mocked(api);

function renderModal(onClose = vi.fn(), onCreated = vi.fn(), open = true) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <CreateProjectModal
            open={open}
            onClose={onClose}
            onCreated={onCreated}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CreateProjectModal", () => {
  it("renders nothing when closed", () => {
    renderModal(vi.fn(), vi.fn(), false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders modal when open", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toBeInTheDocument();
  });

  it("validates empty name", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Project name is required")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("validates whitespace-only name", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Project name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Project name is required")).toBeInTheDocument();
  });

  it("limits name input to 160 characters", () => {
    renderModal();
    expect(screen.getByLabelText("Project name")).toHaveAttribute(
      "maxLength",
      "160",
    );
  });

  it("calls api.post and onCreated on success", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const project = {
      id: "p1",
      name: "Test Project",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    mockedApi.post.mockImplementation((path: string) => {
      if (path === "/projects") return Promise.resolve({ project });
      // main.tex creation
      return Promise.resolve({
        document: { id: "d1", path: "/main.tex" },
      });
    });
    mockedApi.put.mockResolvedValue(undefined);
    renderModal(vi.fn(), onCreated);

    await user.type(screen.getByLabelText("Project name"), "Test Project");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        id: "p1",
        name: "Test Project",
        myRole: "admin",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    });
    expect(mockedApi.post).toHaveBeenCalledWith("/projects", {
      name: "Test Project",
    });
  });

  it("creates main.tex and sets as main document after project creation", async () => {
    const user = userEvent.setup();
    const project = {
      id: "p1",
      name: "Test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    mockedApi.post.mockImplementation((path: string) => {
      if (path === "/projects") return Promise.resolve({ project });
      return Promise.resolve({
        document: { id: "doc-main", path: "/main.tex" },
      });
    });
    mockedApi.put.mockResolvedValue(undefined);
    renderModal();

    await user.type(screen.getByLabelText("Project name"), "Test");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith("/projects/p1/files", {
        path: "/main.tex",
        kind: "text",
      });
    });
    expect(mockedApi.put).toHaveBeenCalledWith("/projects/p1/main-document", {
      documentId: "doc-main",
    });
  });

  it("shows server error on API failure", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(400, "Name already taken"),
    );
    renderModal();

    await user.type(screen.getByLabelText("Project name"), "Duplicate");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Name already taken");
    });
  });

  it("disables button while submitting", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockImplementation(() => new Promise(() => {}));
    renderModal();

    await user.type(screen.getByLabelText("Project name"), "Test");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    const backdrop = screen.getByRole("dialog");
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows field-level error from server", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(400, "Validation failed", { name: "Name already exists" }),
    );
    renderModal();

    await user.type(screen.getByLabelText("Project name"), "Duplicate");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Name already exists")).toBeInTheDocument();
    });
  });

  it("still calls onCreated when main.tex creation fails", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const project = {
      id: "p1",
      name: "Test",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    mockedApi.post.mockImplementation((path: string) => {
      if (path === "/projects") return Promise.resolve({ project });
      return Promise.reject(new ApiError(500, "Internal error"));
    });
    renderModal(vi.fn(), onCreated);

    await user.type(screen.getByLabelText("Project name"), "Test");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        id: "p1",
        name: "Test",
        myRole: "admin",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    });
  });
});
