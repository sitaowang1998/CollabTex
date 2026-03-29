import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { ProjectSnapshot } from "@collab-tex/shared";
import { api, ApiError } from "../lib/api";
import SnapshotPanel from "./SnapshotPanel";

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

const snapshots: ProjectSnapshot[] = [
  {
    id: "s1",
    projectId: "p1",
    message: "Initial commit",
    authorId: "u1",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "s2",
    projectId: "p1",
    message: null,
    authorId: "u2",
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
];

function renderPanel(
  props: Partial<{
    projectId: string;
    myRole: "admin" | "editor" | "commenter" | "reader";
    onClose: () => void;
  }> = {},
) {
  const defaults = {
    projectId: "p1",
    myRole: "admin" as const,
    onClose: vi.fn(),
  };
  const merged = { ...defaults, ...props };

  const router = createMemoryRouter(
    [
      {
        path: "/projects/:projectId",
        element: <SnapshotPanel {...merged} />,
      },
    ],
    { initialEntries: [`/projects/${merged.projectId}`] },
  );
  return { ...render(<RouterProvider router={router} />), ...merged };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedApi.get.mockResolvedValue({ snapshots });
});

describe("SnapshotPanel", () => {
  it("renders loading state while fetching", () => {
    mockedApi.get.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByText("Loading snapshots…")).toBeInTheDocument();
  });

  it("renders snapshot list after fetch", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();
  });

  it("renders empty state when no snapshots", async () => {
    mockedApi.get.mockResolvedValue({ snapshots: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("No snapshots yet.")).toBeInTheDocument();
    });
  });

  it("renders error state with retry", async () => {
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server error"));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retries fetch on retry click", async () => {
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Server error"));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    mockedApi.get.mockResolvedValue({ snapshots });
    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
  });

  it("shows restore button for admin", async () => {
    renderPanel({ myRole: "admin" });
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
  });

  it("shows restore button for editor", async () => {
    renderPanel({ myRole: "editor" });
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
  });

  it("hides restore button for reader", async () => {
    renderPanel({ myRole: "reader" });
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Restore" }),
    ).not.toBeInTheDocument();
  });

  it("hides restore button for commenter", async () => {
    renderPanel({ myRole: "commenter" });
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Restore" }),
    ).not.toBeInTheDocument();
  });

  it("shows confirmation dialog when clicking restore", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole("button", { name: "Restore" })[0],
    );
    expect(screen.getByText("Restore Snapshot")).toBeInTheDocument();
    expect(screen.getByText(/restore the project/)).toBeInTheDocument();
  });

  it("calls restore API on confirm", async () => {
    mockedApi.post.mockResolvedValue({ snapshot: snapshots[0] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole("button", { name: "Restore" })[0],
    );

    const confirmButton = screen
      .getByRole("dialog", { name: "Confirm restore" })
      .querySelector("button:last-child")!;
    await userEvent.click(confirmButton);

    expect(mockedApi.post).toHaveBeenCalledWith(
      "/projects/p1/snapshots/s1/restore",
    );
  });

  it("shows error on restore failure", async () => {
    mockedApi.post.mockRejectedValue(new ApiError(500, "Restore failed"));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole("button", { name: "Restore" })[0],
    );

    const dialog = screen.getByRole("dialog", { name: "Confirm restore" });
    const buttons = dialog.querySelectorAll("button");
    const restoreBtn = Array.from(buttons).find(
      (b) => b.textContent === "Restore",
    )!;
    await userEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText("Restore failed")).toBeInTheDocument();
    });
  });

  it("shows corrupt snapshot message on 422", async () => {
    mockedApi.post.mockRejectedValue(
      new ApiError(422, "Snapshot blob is invalid"),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getAllByRole("button", { name: "Restore" })[0],
    );

    const dialog = screen.getByRole("dialog", { name: "Confirm restore" });
    const buttons = dialog.querySelectorAll("button");
    const restoreBtn = Array.from(buttons).find(
      (b) => b.textContent === "Restore",
    )!;
    await userEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText("Snapshot blob is invalid")).toBeInTheDocument();
    });
  });

  it("closes panel via close button", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Close snapshots panel" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("closes panel via Escape key", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    await waitFor(() => {
      expect(screen.getByText("Initial commit")).toBeInTheDocument();
    });
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
