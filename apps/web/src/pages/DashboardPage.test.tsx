import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { AuthUser } from "@collab-tex/shared";
import { AuthProvider } from "../contexts/AuthContext";
import { api, ApiError } from "../lib/api";
import DashboardPage from "./DashboardPage";

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

const authUser: AuthUser = { id: "u1", email: "a@b.com", name: "Alice" };

function renderDashboard() {
  // Simulate authenticated state: token in localStorage, GET /auth/me returns user
  localStorage.setItem("token", "tok");
  mockedApi.get.mockImplementation((path: string) => {
    if (path === "/auth/me") return Promise.resolve(authUser);
    // Default: return empty projects
    return Promise.resolve({ projects: [] });
  });

  const router = createMemoryRouter(
    [
      { path: "/", element: <DashboardPage /> },
      { path: "/login", element: <div>Login Page</div> },
      { path: "/projects/:id", element: <div>Project Page</div> },
    ],
    { initialEntries: ["/"] },
  );
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("DashboardPage", () => {
  it("shows loading state initially", () => {
    localStorage.setItem("token", "tok");
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      return new Promise(() => {}); // never resolves
    });

    const router = createMemoryRouter(
      [{ path: "/", element: <DashboardPage /> }],
      { initialEntries: ["/"] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    expect(screen.getByText(/loading projects/i)).toBeInTheDocument();
  });

  it("shows empty state when no projects", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/don't have any projects/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /create your first project/i }),
    ).toBeInTheDocument();
  });

  it("renders project cards when projects exist", async () => {
    localStorage.setItem("token", "tok");
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      return Promise.resolve({
        projects: [
          {
            id: "p1",
            name: "Project Alpha",
            myRole: "admin",
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    });

    const router = createMemoryRouter(
      [
        { path: "/", element: <DashboardPage /> },
        { path: "/projects/:id", element: <div>Project Page</div> },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    });
  });

  it("shows error state with retry button", async () => {
    localStorage.setItem("token", "tok");
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      return Promise.reject(new ApiError(500, "Server error"));
    });

    const router = createMemoryRouter(
      [{ path: "/", element: <DashboardPage /> }],
      { initialEntries: ["/"] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server error");
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retry button re-fetches projects", async () => {
    const user = userEvent.setup();
    localStorage.setItem("token", "tok");

    let callCount = 0;
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new ApiError(500, "Server error"));
      }
      return Promise.resolve({ projects: [] });
    });

    const router = createMemoryRouter(
      [{ path: "/", element: <DashboardPage /> }],
      { initialEntries: ["/"] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText(/don't have any projects/i)).toBeInTheDocument();
    });
  });

  it("opens create modal from New Project button", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /new project/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /new project/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens create modal from empty state CTA", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /create your first project/i }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /create your first project/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("adds created project to list without refetch", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /new project/i }),
      ).toBeInTheDocument();
    });

    mockedApi.post.mockResolvedValueOnce({
      project: {
        id: "new-1",
        name: "Brand New",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });

    await user.click(screen.getByRole("button", { name: /new project/i }));
    await user.type(screen.getByLabelText("Project name"), "Brand New");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Brand New")).toBeInTheDocument();
    });
  });
});
