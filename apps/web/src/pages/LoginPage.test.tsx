import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { AuthUser } from "@collab-tex/shared";
import { AuthProvider } from "../contexts/AuthContext";
import { api, ApiError } from "../lib/api";
import LoginPage from "./LoginPage";

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

function renderLogin(initialEntry = "/login") {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <div>Register Page</div> },
      { path: "/", element: <div>Dashboard</div> },
      { path: "/projects/:id", element: <div>Project</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

function renderLoginWithFrom(from: string) {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/projects/:id", element: <div>Project</div> },
    ],
    {
      initialEntries: [
        { pathname: "/login", state: { from: { pathname: from } } },
      ],
    },
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

describe("LoginPage", () => {
  it("renders email, password inputs and submit button", () => {
    renderLogin();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("shows validation errors for empty fields on submit", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("calls login on valid submit and navigates to /", async () => {
    const user = userEvent.setup();
    const authUser: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.post.mockResolvedValueOnce({ token: "tok", user: authUser });
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/login", {
      email: "a@b.com",
      password: "pass123",
    });
  });

  it("navigates to from location on success when redirected", async () => {
    const user = userEvent.setup();
    const authUser: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.post.mockResolvedValueOnce({ token: "tok", user: authUser });
    renderLoginWithFrom("/projects/abc");

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByText("Project")).toBeInTheDocument();
    });
  });

  it("shows server error message on API failure", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(401, "Invalid credentials"),
    );
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Invalid credentials",
      );
    });
  });

  it("shows field-level errors from API response", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(400, "Validation failed", { email: "Email already taken" }),
    );
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "pass");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByText("Email already taken")).toBeInTheDocument();
    });
  });

  it("disables button and shows loading text while submitting", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockImplementation(() => new Promise(() => {}));
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "pass");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const button = screen.getByRole("button", { name: /logging in/i });
    expect(button).toBeDisabled();
  });

  it("shows generic error for non-ApiError failures", async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.post.mockRejectedValueOnce(new Error("network failure"));
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "pass");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "An unexpected error occurred",
      );
    });
    consoleSpy.mockRestore();
  });

  it("re-enables submit button after failed submission", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(401, "Invalid credentials"),
    );
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const button = screen.getByRole("button", { name: "Log in" });
    expect(button).not.toBeDisabled();
  });

  it("has link to register page", async () => {
    const user = userEvent.setup();
    renderLogin();
    const link = screen.getByRole("link", { name: /register/i });
    expect(link).toHaveAttribute("href", "/register");

    await user.click(link);
    await waitFor(() => {
      expect(screen.getByText("Register Page")).toBeInTheDocument();
    });
  });
});
