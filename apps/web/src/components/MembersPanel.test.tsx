import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { ProjectMember } from "@collab-tex/shared";
import { api, ApiError } from "../lib/api";
import MembersPanel from "./MembersPanel";

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

const members: ProjectMember[] = [
  { userId: "u1", email: "alice@test.com", name: "Alice", role: "admin" },
  { userId: "u2", email: "bob@test.com", name: "Bob", role: "editor" },
  { userId: "u3", email: "carol@test.com", name: "Carol", role: "reader" },
];

function renderPanel(
  props: Partial<{
    projectId: string;
    myRole: "admin" | "editor" | "commenter" | "reader";
    currentUserId: string;
    onClose: () => void;
    onProjectDeleted: () => void;
  }> = {},
) {
  const defaults = {
    projectId: "p1",
    myRole: "admin" as const,
    currentUserId: "u1",
    onClose: vi.fn(),
    onProjectDeleted: vi.fn(),
  };
  const merged = { ...defaults, ...props };

  const router = createMemoryRouter(
    [
      {
        path: "/projects/:projectId",
        element: <MembersPanel {...merged} />,
      },
      {
        path: "/",
        element: <div>Dashboard</div>,
      },
    ],
    { initialEntries: [`/projects/${merged.projectId}`] },
  );
  return { ...render(<RouterProvider router={router} />), router, ...merged };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedApi.get.mockResolvedValue({ members });
});

describe("MembersPanel", () => {
  it("renders loading state while fetching", () => {
    mockedApi.get.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByText("Loading members…")).toBeInTheDocument();
  });

  it("renders member list after fetch", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();
    expect(screen.getByText("bob@test.com")).toBeInTheDocument();
  });

  it("shows error with retry on fetch failure", async () => {
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Server error"));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();

    // Retry
    mockedApi.get.mockResolvedValueOnce({ members });
    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
  });

  it("admin sees add form and controls", async () => {
    renderPanel({ myRole: "admin" });
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Add member")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Bob")).toBeInTheDocument();
  });

  it("non-admin sees read-only list", async () => {
    renderPanel({ myRole: "reader", currentUserId: "u3" });
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
    expect(
      screen.queryByPlaceholderText("Email address"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove Bob")).not.toBeInTheDocument();
    // Shows role badges instead of selects
    const list = screen.getByRole("list");
    expect(within(list).getAllByText("admin")).toHaveLength(1);
    expect(within(list).getAllByText("editor")).toHaveLength(1);
    expect(within(list).getAllByText("reader")).toHaveLength(1);
  });

  it("add member: success appends to list", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    const newMember: ProjectMember = {
      userId: "u4",
      email: "dave@test.com",
      name: "Dave",
      role: "editor",
    };
    mockedApi.post.mockResolvedValueOnce({ member: newMember });

    await user.type(
      screen.getByPlaceholderText("Email address"),
      "dave@test.com",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Dave")).toBeInTheDocument();
    });
    expect(mockedApi.post).toHaveBeenCalledWith("/projects/p1/members", {
      email: "dave@test.com",
      role: "editor",
    });
  });

  it("add member: shows error on 404", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    mockedApi.post.mockRejectedValueOnce(new ApiError(404, "User not found"));
    await user.type(
      screen.getByPlaceholderText("Email address"),
      "no@test.com",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("User not found")).toBeInTheDocument();
    });
  });

  it("add member: shows error on 409", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    mockedApi.post.mockRejectedValueOnce(new ApiError(409, "Already a member"));
    await user.type(
      screen.getByPlaceholderText("Email address"),
      "bob@test.com",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Already a member")).toBeInTheDocument();
    });
  });

  it("add member: button disabled with empty email", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("add member: validates invalid email format", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Email address"), "notanemail");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("role change: shows confirmation dialog and applies on confirm", async () => {
    const user = userEvent.setup();
    mockedApi.patch.mockResolvedValueOnce({
      member: { ...members[1], role: "commenter" },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    const roleSelect = screen.getByLabelText("Role for Bob");
    await user.selectOptions(roleSelect, "commenter");

    // Confirmation dialog should appear
    const dialog = screen.getByRole("dialog", { name: "Change Role" });
    expect(
      within(dialog).getByText("Change Bob's role to commenter?"),
    ).toBeInTheDocument();

    // Confirm
    await user.click(within(dialog).getByRole("button", { name: "Change" }));

    expect(mockedApi.patch).toHaveBeenCalledWith("/projects/p1/members/u2", {
      role: "commenter",
    });
  });

  it("role change: cancel does not apply change", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    const roleSelect = screen.getByLabelText("Role for Bob");
    await user.selectOptions(roleSelect, "commenter");

    const dialog = screen.getByRole("dialog", { name: "Change Role" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    // Role stays as editor
    expect(roleSelect).toHaveValue("editor");
  });

  it("role change: reverts on error", async () => {
    const user = userEvent.setup();
    mockedApi.patch.mockRejectedValueOnce(new ApiError(500, "Failed"));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    const roleSelect = screen.getByLabelText("Role for Bob");
    await user.selectOptions(roleSelect, "commenter");

    // Confirm the change
    const dialog = screen.getByRole("dialog", { name: "Change Role" });
    await user.click(within(dialog).getByRole("button", { name: "Change" }));

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
    // Role should revert to editor
    expect(roleSelect).toHaveValue("editor");
  });

  it("remove: optimistic removal + DELETE call", async () => {
    const user = userEvent.setup();
    mockedApi.delete.mockResolvedValueOnce(undefined);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Remove Bob"));

    await waitFor(() => {
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    });
    expect(mockedApi.delete).toHaveBeenCalledWith("/projects/p1/members/u2");
  });

  it("remove: reverts on error", async () => {
    const user = userEvent.setup();
    mockedApi.delete.mockRejectedValueOnce(
      new ApiError(500, "Failed to remove"),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Remove Bob"));

    await waitFor(() => {
      expect(screen.getByText("Failed to remove")).toBeInTheDocument();
    });
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("cannot demote last admin", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    const roleSelect = screen.getByLabelText("Role for Alice");
    await user.selectOptions(roleSelect, "editor");

    expect(
      screen.getByText("Cannot demote the last admin"),
    ).toBeInTheDocument();
    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it("does not show remove button for current user", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Alice is current user — no remove button
    expect(screen.queryByLabelText("Remove Alice")).not.toBeInTheDocument();
    // Bob is another member — remove button shown
    expect(screen.getByLabelText("Remove Bob")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Close members panel"));
    expect(onClose).toHaveBeenCalled();
  });

  describe("Leave Project", () => {
    it("non-admin sees Leave Project button", async () => {
      renderPanel({ myRole: "editor", currentUserId: "u2" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("button", { name: "Leave Project" }),
      ).toBeInTheDocument();
    });

    it("sole admin sees disabled Leave Project button with tooltip", async () => {
      renderPanel({ myRole: "admin" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });
      const leaveBtn = screen.getByRole("button", { name: "Leave Project" });
      expect(leaveBtn).toBeDisabled();
      expect(leaveBtn).toHaveAttribute(
        "title",
        "You are the last admin. Transfer admin role to another member before leaving.",
      );
    });

    it("admin with other admins sees Leave Project button", async () => {
      const multiAdminMembers = [
        {
          userId: "u1",
          email: "alice@test.com",
          name: "Alice",
          role: "admin" as const,
        },
        {
          userId: "u2",
          email: "bob@test.com",
          name: "Bob",
          role: "admin" as const,
        },
      ];
      mockedApi.get.mockResolvedValue({ members: multiAdminMembers });
      renderPanel({ myRole: "admin" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("button", { name: "Leave Project" }),
      ).toBeInTheDocument();
    });

    it("confirmation requires typing LEAVE PROJECT", async () => {
      const user = userEvent.setup();
      renderPanel({ myRole: "editor", currentUserId: "u2" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Leave Project" }));
      const dialog = screen.getByRole("dialog", { name: "Leave Project" });
      const confirmBtn = within(dialog).getByRole("button", { name: "Leave" });
      expect(confirmBtn).toBeDisabled();

      await user.type(within(dialog).getByLabelText(/Type/), "LEAVE PROJECT");
      expect(confirmBtn).toBeEnabled();
    });

    it("on confirm, calls DELETE self and navigates to dashboard", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockResolvedValueOnce(undefined);
      const { router } = renderPanel({
        myRole: "editor",
        currentUserId: "u2",
      });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Leave Project" }));
      const dialog = screen.getByRole("dialog", { name: "Leave Project" });
      await user.type(within(dialog).getByLabelText(/Type/), "LEAVE PROJECT");
      await user.click(within(dialog).getByRole("button", { name: "Leave" }));

      await waitFor(() => {
        expect(mockedApi.delete).toHaveBeenCalledWith(
          "/projects/p1/members/u2",
        );
      });
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
    });

    it("on error, shows error in dialog and does NOT navigate", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockRejectedValueOnce(new ApiError(500, "Server error"));
      const { router } = renderPanel({
        myRole: "editor",
        currentUserId: "u2",
      });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Leave Project" }));
      const dialog = screen.getByRole("dialog", { name: "Leave Project" });
      await user.type(within(dialog).getByLabelText(/Type/), "LEAVE PROJECT");
      await user.click(within(dialog).getByRole("button", { name: "Leave" }));

      await waitFor(() => {
        expect(within(dialog).getByText("Server error")).toBeInTheDocument();
      });
      expect(router.state.location.pathname).not.toBe("/");
    });
  });

  describe("Delete Project", () => {
    it("admin sees Delete Project button", async () => {
      renderPanel({ myRole: "admin" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("button", { name: "Delete Project" }),
      ).toBeInTheDocument();
    });

    it("non-admin does NOT see Delete Project button", async () => {
      renderPanel({ myRole: "editor", currentUserId: "u2" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: "Delete Project" }),
      ).not.toBeInTheDocument();
    });

    it("confirmation requires typing DELETE PROJECT", async () => {
      const user = userEvent.setup();
      renderPanel({ myRole: "admin" });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Delete Project" }));
      const dialog = screen.getByRole("dialog", { name: "Delete Project" });
      const confirmBtn = within(dialog).getByRole("button", {
        name: "Delete",
      });
      expect(confirmBtn).toBeDisabled();

      await user.type(within(dialog).getByLabelText(/Type/), "DELETE PROJECT");
      expect(confirmBtn).toBeEnabled();
    });

    it("on confirm, calls DELETE project and triggers onProjectDeleted", async () => {
      const user = userEvent.setup();
      const onProjectDeleted = vi.fn();
      mockedApi.delete.mockResolvedValueOnce(undefined);
      renderPanel({ myRole: "admin", onProjectDeleted });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Delete Project" }));
      const dialog = screen.getByRole("dialog", { name: "Delete Project" });
      await user.type(within(dialog).getByLabelText(/Type/), "DELETE PROJECT");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockedApi.delete).toHaveBeenCalledWith("/projects/p1");
      });
      await waitFor(() => {
        expect(onProjectDeleted).toHaveBeenCalled();
      });
    });

    it("on error, shows error in dialog and does NOT call onProjectDeleted", async () => {
      const user = userEvent.setup();
      const onProjectDeleted = vi.fn();
      mockedApi.delete.mockRejectedValueOnce(
        new ApiError(500, "Delete failed"),
      );
      renderPanel({ myRole: "admin", onProjectDeleted });
      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Delete Project" }));
      const dialog = screen.getByRole("dialog", { name: "Delete Project" });
      await user.type(within(dialog).getByLabelText(/Type/), "DELETE PROJECT");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(within(dialog).getByText("Delete failed")).toBeInTheDocument();
      });
      expect(onProjectDeleted).not.toHaveBeenCalled();
    });
  });
});
