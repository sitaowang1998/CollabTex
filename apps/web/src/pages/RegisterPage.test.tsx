import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { AuthUser } from "@collab-tex/shared";
import { AuthProvider } from "../contexts/AuthContext";
import { api, ApiError } from "../lib/api";
import RegisterPage from "./RegisterPage";

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

function renderRegister() {
  const router = createMemoryRouter(
    [
      { path: "/register", element: <RegisterPage /> },
      { path: "/login", element: <div>Login Page</div> },
      { path: "/", element: <div>Dashboard</div> },
    ],
    { initialEntries: ["/register"] },
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

describe("RegisterPage", () => {
  it("renders email, name, password inputs and submit button", () => {
    renderRegister();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
  });

  it("shows validation errors for empty fields on submit", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("shows validation error for invalid email format", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "notanemail");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("calls register on valid submit and navigates to /", async () => {
    const user = userEvent.setup();
    const authUser: AuthUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.post.mockResolvedValueOnce({ token: "tok", user: authUser });
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
    expect(mockedApi.post).toHaveBeenCalledWith("/auth/register", {
      email: "a@b.com",
      name: "Alice",
      password: "pass123",
    });
  });

  it("shows server error message on API failure", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(409, "User already exists"),
    );
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "User already exists",
      );
    });
  });

  it("shows field-level errors from API response", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce(
      new ApiError(400, "Validation failed", {
        email: "Email already registered",
      }),
    );
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("Email already registered")).toBeInTheDocument();
    });
  });

  it("shows generic error for non-ApiError failures", async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.post.mockRejectedValueOnce(new Error("network failure"));
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

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
      new ApiError(409, "User already exists"),
    );
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const button = screen.getByRole("button", { name: "Create account" });
    expect(button).not.toBeDisabled();
  });

  it("disables button and shows loading text while submitting", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockImplementation(() => new Promise(() => {}));
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "pass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const button = screen.getByRole("button", { name: /creating account/i });
    expect(button).toBeDisabled();
  });

  it("has link to login page", async () => {
    const user = userEvent.setup();
    renderRegister();
    const link = screen.getByRole("link", { name: /log in/i });
    expect(link).toHaveAttribute("href", "/login");

    await user.click(link);
    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
  });
});
