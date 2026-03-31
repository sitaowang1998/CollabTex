// ProtectedRoute and PublicRoute integration tests within the application routing structure.
// These are tested here (not in co-located files) because their behavior
// is inherently tied to route transitions, redirects, and location state.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import type { AuthUser } from "@collab-tex/shared";
import { AuthProvider } from "./contexts/AuthContext";
import { useAuth } from "./contexts/useAuth";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicRoute from "./components/PublicRoute";
import { api, ApiError } from "./lib/api";

// Mock the external API boundary, not internal hooks
vi.mock("./lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api")>();
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

// Exposes retryAuth for tests that need to trigger background re-verification
// from an authenticated state (to reach backgroundError/refreshing).
function RetryTrigger() {
  const { retryAuth } = useAuth();
  return (
    <button data-testid="trigger-retry" onClick={() => retryAuth()}>
      trigger retry
    </button>
  );
}

function LoginLocationDisplay() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from;
  return <div data-testid="from-pathname">{from?.pathname ?? ""}</div>;
}

function renderWithRouter(
  initialEntry: string,
  { includeRetryTrigger = false } = {},
) {
  const router = createMemoryRouter(
    [
      {
        element: <PublicRoute />,
        children: [
          { path: "/login", element: <div>Login Page</div> },
          { path: "/register", element: <div>Register Page</div> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          { path: "/", element: <h1>Dashboard</h1> },
          { path: "/projects/:projectId", element: <div>Project</div> },
        ],
      },
      { path: "*", element: <div>Page not found</div> },
    ],
    { initialEntries: [initialEntry] },
  );

  return render(
    <AuthProvider>
      {includeRetryTrigger && <RetryTrigger />}
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("ProtectedRoute", () => {
  it("redirects to /login when unauthenticated", () => {
    renderWithRouter("/");
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("shows loading text when loading", () => {
    localStorage.setItem("token", "valid-token");
    mockedApi.get.mockImplementation(() => new Promise(() => {}));
    renderWithRouter("/");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders child route when authenticated", async () => {
    localStorage.setItem("token", "valid-token");
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });
    renderWithRouter("/");
    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  it("renders /login without auth", () => {
    renderWithRouter("/login");
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("renders /register without auth", () => {
    renderWithRouter("/register");
    expect(screen.getByText("Register Page")).toBeInTheDocument();
  });

  it("renders nested /projects/:projectId when authenticated", async () => {
    localStorage.setItem("token", "valid-token");
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });
    renderWithRouter("/projects/abc");
    await waitFor(() => {
      expect(screen.getByText("Project")).toBeInTheDocument();
    });
  });

  it("redirects /projects/:projectId to login when unauthenticated", () => {
    renderWithRouter("/projects/abc");
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("shows error with retry when in error state", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Network error"));
    renderWithRouter("/");
    await waitFor(() => {
      expect(screen.getByText("Authentication failed")).toBeInTheDocument();
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to Login" }),
    ).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("retry button re-fetches authentication", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Network error"));
    renderWithRouter("/");
    await waitFor(() => {
      expect(screen.getByText("Authentication failed")).toBeInTheDocument();
    });

    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
    expect(mockedApi.get).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("go to login button clears session and redirects", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Network error"));
    renderWithRouter("/");
    await waitFor(() => {
      expect(screen.getByText("Authentication failed")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Go to Login" }));

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
    expect(localStorage.getItem("token")).toBeNull();
    consoleSpy.mockRestore();
  });

  it("renders child route with error banner when in backgroundError state", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });
    renderWithRouter("/", { includeRetryTrigger: true });

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Stale error"));
    fireEvent.click(screen.getByTestId("trigger-retry"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Something went wrong: Stale error",
      );
    });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("backgroundError retry button re-fetches authentication", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });
    renderWithRouter("/", { includeRetryTrigger: true });

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Stale error"));
    fireEvent.click(screen.getByTestId("trigger-retry"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    mockedApi.get.mockResolvedValueOnce({ user });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("redirect to /login carries state.from with current location", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/login",
          element: <LoginLocationDisplay />,
        },
        {
          element: <ProtectedRoute />,
          children: [
            {
              path: "/projects/:projectId",
              element: <div>Project</div>,
            },
          ],
        },
      ],
      { initialEntries: ["/projects/abc"] },
    );

    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    expect(screen.getByTestId("from-pathname").textContent).toBe(
      "/projects/abc",
    );
  });

  it("renders child route when refreshing (no loading flash)", async () => {
    localStorage.setItem("token", "valid-token");
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });
    renderWithRouter("/", { includeRetryTrigger: true });

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    mockedApi.get.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByTestId("trigger-retry"));

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("renders 'Page not found' for unknown routes", () => {
    renderWithRouter("/nonexistent-page");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});

describe("PublicRoute", () => {
  it("renders /login when unauthenticated", () => {
    renderWithRouter("/login");
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("renders /register when unauthenticated", () => {
    renderWithRouter("/register");
    expect(screen.getByText("Register Page")).toBeInTheDocument();
  });

  it("redirects /login to dashboard when authenticated", async () => {
    localStorage.setItem("token", "valid-token");
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });
    renderWithRouter("/login");
    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  it("redirects /register to dashboard when authenticated", async () => {
    localStorage.setItem("token", "valid-token");
    const user: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });
    renderWithRouter("/register");
    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  it("shows loading when verifying token on /login", () => {
    localStorage.setItem("token", "valid-token");
    mockedApi.get.mockImplementation(() => new Promise(() => {}));
    renderWithRouter("/login");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders /login when token verification fails with error", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server error"));
    renderWithRouter("/login");
    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });
});
