import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./useAuth";
import { api, ApiError } from "../lib/api";
import { authReducer, type AuthState } from "./AuthContextDef";

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

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe("AuthContext", () => {
  it("starts unauthenticated when no token", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state).toEqual({ status: "unauthenticated" });
  });

  it("fetches user on mount when token exists", async () => {
    localStorage.setItem("token", "valid-token");
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state).toEqual({ status: "loading" });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );
    expect(mockedApi.get).toHaveBeenCalledWith("/auth/me");
  });

  it("clears token and localStorage when /me fails with 401", async () => {
    localStorage.setItem("token", "bad-token");
    mockedApi.get.mockRejectedValue(new ApiError(401, "Unauthorized"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("sets error state and keeps token when /me fails with network error", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(0, "Network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Network error",
      }),
    );
    expect(localStorage.getItem("token")).toBe("valid-token");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to verify authentication:",
      expect.any(ApiError),
    );
    consoleSpy.mockRestore();
  });

  it("sets error state when /me fails with server error", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Internal Server Error"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Internal Server Error",
      }),
    );
    expect(localStorage.getItem("token")).toBe("valid-token");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to verify authentication:",
      expect.any(ApiError),
    );
    consoleSpy.mockRestore();
  });

  it("login() sets authenticated state", async () => {
    const authResponse = {
      token: "new-token",
      user: { id: "1", email: "a@b.com", name: "Alice" },
    };
    mockedApi.post.mockResolvedValue(authResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login("a@b.com", "password");
    });

    expect(mockedApi.post).toHaveBeenCalledWith("/auth/login", {
      email: "a@b.com",
      password: "password",
    });
    expect(result.current.state).toEqual({
      status: "authenticated",
      user: authResponse.user,
    });
    expect(localStorage.getItem("token")).toBe("new-token");
  });

  it("login() does not trigger redundant /auth/me fetch", async () => {
    const authResponse = {
      token: "new-token",
      user: { id: "1", email: "a@b.com", name: "Alice" },
    };
    mockedApi.post.mockResolvedValue(authResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login("a@b.com", "password");
    });

    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it("login() propagates errors and leaves state unchanged", async () => {
    mockedApi.post.mockRejectedValue(new ApiError(422, "Invalid credentials"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(() => result.current.login("a@b.com", "wrong")),
    ).rejects.toThrow("Invalid credentials");

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("login() throws on invalid server response", async () => {
    mockedApi.post.mockResolvedValue({});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(() => result.current.login("a@b.com", "password")),
    ).rejects.toThrow("Invalid server response: missing token or user");

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("register() sets authenticated state", async () => {
    const authResponse = {
      token: "reg-token",
      user: { id: "2", email: "b@c.com", name: "Bob" },
    };
    mockedApi.post.mockResolvedValue(authResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.register("b@c.com", "Bob", "password");
    });

    expect(mockedApi.post).toHaveBeenCalledWith("/auth/register", {
      email: "b@c.com",
      name: "Bob",
      password: "password",
    });
    expect(result.current.state).toEqual({
      status: "authenticated",
      user: authResponse.user,
    });
    expect(localStorage.getItem("token")).toBe("reg-token");
  });

  it("register() propagates errors and leaves state unchanged", async () => {
    mockedApi.post.mockRejectedValue(new ApiError(422, "Email already taken"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(() => result.current.register("taken@b.com", "Bob", "password")),
    ).rejects.toThrow("Email already taken");

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("register() throws on invalid server response", async () => {
    mockedApi.post.mockResolvedValue({ token: "t" });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(() => result.current.register("a@b.com", "Bob", "password")),
    ).rejects.toThrow("Invalid server response: missing token or user");

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("logout() clears state and localStorage", async () => {
    localStorage.setItem("token", "valid-token");
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    act(() => {
      result.current.logout();
    });

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("logout() clears error state", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server down"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Server down",
      }),
    );

    act(() => {
      result.current.logout();
    });

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    consoleSpy.mockRestore();
  });

  it("clears error after successful login", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server down"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Server down",
      }),
    );

    const authResponse = {
      token: "new-token",
      user: { id: "1", email: "a@b.com", name: "Alice" },
    };
    mockedApi.post.mockResolvedValue(authResponse);

    await act(async () => {
      await result.current.login("a@b.com", "password");
    });

    expect(result.current.state).toEqual({
      status: "authenticated",
      user: authResponse.user,
    });
    consoleSpy.mockRestore();
  });

  it("sets error with message when /me fails with non-ApiError", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new Error("something broke"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "something broke",
      }),
    );
    consoleSpy.mockRestore();
  });

  it("sets unauthenticated and clears token when /me returns null user", async () => {
    localStorage.setItem("token", "valid-token");
    mockedApi.get.mockResolvedValue({ user: null });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("retryAuth() sets loading, re-fetches /auth/me", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server down"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Server down",
      }),
    );
    expect(mockedApi.get).toHaveBeenCalledTimes(1);

    // Setup success for retry
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValue({ user });

    act(() => {
      result.current.retryAuth();
    });

    expect(result.current.state).toEqual({ status: "loading" });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );
    expect(mockedApi.get).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("retryAuth() handles repeated failure", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(500, "Server down"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Server down",
      }),
    );

    // Retry also fails
    mockedApi.get.mockRejectedValue(new ApiError(500, "Still down"));

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "Still down",
      }),
    );
    consoleSpy.mockRestore();
  });

  it("retryAuth() transitions to unauthenticated when no token in localStorage", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue(new ApiError(401, "Unauthorized"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    // 401 clears the token from localStorage
    expect(localStorage.getItem("token")).toBeNull();

    // retryAuth with no token should transition to unauthenticated
    act(() => {
      result.current.retryAuth();
    });

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    // Should not have made a second API call
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("retryAuth() clears stale user when server returns null user", async () => {
    localStorage.setItem("token", "valid-token");
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // Retry returns { user: null }
    mockedApi.get.mockResolvedValueOnce({ user: null });

    act(() => {
      result.current.retryAuth();
    });

    // Should use refreshing (not loading) since user was authenticated
    expect(result.current.state).toEqual({ status: "refreshing", user });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("retryAuth() cancels previous in-flight verifyAuth call", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // First mount call: slow failure
    let rejectFirst!: (err: Error) => void;
    mockedApi.get.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));

    // Retry: fast success
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // Now the slow first call fails — should be ignored
    rejectFirst(new ApiError(500, "Slow failure"));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));

    // User should still be the successful retry result
    expect(result.current.state).toEqual({ status: "authenticated", user });
    consoleSpy.mockRestore();
  });

  it("does not update state when unmounted during in-flight verifyAuth", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let resolveGet!: (value: unknown) => void;
    mockedApi.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state).toEqual({ status: "loading" });

    unmount();

    // Resolve after unmount — should not throw or update state
    resolveGet({ user: { id: "1", email: "a@b.com", name: "Alice" } });

    // If we got here without errors, the cancelled guard worked
    consoleSpy.mockRestore();
  });

  it("sets error for non-Error thrown values", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApi.get.mockRejectedValue("string error");

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        error: "An unknown error occurred",
      }),
    );
    consoleSpy.mockRestore();
  });

  it("preserves authenticated user when retryAuth fails with transient error", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // Retry fails with 500 — user should be preserved via backgroundError
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Server down"));

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "backgroundError",
        user,
        error: "Server down",
      }),
    );
    consoleSpy.mockRestore();
  });

  it("sets unauthenticated when localStorage cleared before effect runs", async () => {
    // Simulate: state initialized to loading because token existed at useState time
    localStorage.setItem("token", "valid-token");

    // But clear it before React runs the effect (simulating another tab logging out)
    const originalGetItem = Storage.prototype.getItem;
    let callCount = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      callCount++;
      // First call is from useState initializer (returns token),
      // second call is from useEffect (returns null — token was cleared)
      if (key === "token" && callCount > 1) return null;
      return originalGetItem.call(this, key);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    expect(mockedApi.get).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it.each([
    {
      op: "login",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.login("bob@b.com", "password"),
    },
    {
      op: "register",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.register("bob@b.com", "Bob", "password"),
    },
  ])(
    "$op() cancels in-flight verifyAuth — verifyAuth response is ignored",
    async ({ call }) => {
      localStorage.setItem("token", "old-token");

      let resolveVerify!: (value: unknown) => void;
      mockedApi.get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveVerify = resolve;
          }),
      );

      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.state).toEqual({ status: "loading" });

      const newUser = { id: "2", email: "bob@b.com", name: "Bob" };
      mockedApi.post.mockResolvedValue({ token: "bob-token", user: newUser });

      await act(async () => {
        await call(result.current);
      });

      expect(result.current.state).toEqual({
        status: "authenticated",
        user: newUser,
      });

      await act(async () => {
        resolveVerify({
          user: { id: "1", email: "alice@a.com", name: "Alice" },
        });
      });

      expect(result.current.state).toEqual({
        status: "authenticated",
        user: newUser,
      });
      expect(localStorage.getItem("token")).toBe("bob-token");
    },
  );

  it("login() cancels in-flight verifyAuth that returns 401 — new token preserved", async () => {
    localStorage.setItem("token", "expired-token");

    let rejectVerify!: (err: Error) => void;
    mockedApi.get.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectVerify = reject;
        }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state).toEqual({ status: "loading" });

    const loginUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.post.mockResolvedValue({ token: "new-token", user: loginUser });

    await act(async () => {
      await result.current.login("a@b.com", "password");
    });

    expect(result.current.state).toEqual({
      status: "authenticated",
      user: loginUser,
    });
    expect(localStorage.getItem("token")).toBe("new-token");

    // verifyAuth 401 for OLD token arrives — must NOT clear new token
    await act(async () => {
      rejectVerify(new ApiError(401, "Unauthorized"));
    });

    expect(result.current.state).toEqual({
      status: "authenticated",
      user: loginUser,
    });
    expect(localStorage.getItem("token")).toBe("new-token");
  });

  it("logout() cancels in-flight verifyAuth — stays unauthenticated", async () => {
    localStorage.setItem("token", "valid-token");

    let resolveVerify!: (value: unknown) => void;
    mockedApi.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state).toEqual({ status: "loading" });

    act(() => {
      result.current.logout();
    });

    expect(result.current.state).toEqual({ status: "unauthenticated" });

    // verifyAuth resolves — should be ignored
    await act(async () => {
      resolveVerify({ user: { id: "1", email: "a@b.com", name: "Alice" } });
    });

    expect(result.current.state).toEqual({ status: "unauthenticated" });
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("login() clears loading state on success during initial loading", async () => {
    localStorage.setItem("token", "old-token");

    // verifyAuth hangs forever
    mockedApi.get.mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state).toEqual({ status: "loading" });

    const loginUser = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.post.mockResolvedValue({ token: "new-token", user: loginUser });

    await act(async () => {
      await result.current.login("a@b.com", "password");
    });

    expect(result.current.state).toEqual({
      status: "authenticated",
      user: loginUser,
    });
  });

  it.each([
    {
      op: "login",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.login("a@b.com", "wrong"),
    },
    {
      op: "register",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.register("taken@b.com", "Bob", "password"),
    },
  ])(
    "$op() resets loading when api call fails during initial loading",
    async ({ call }) => {
      localStorage.setItem("token", "old-token");

      mockedApi.get.mockImplementationOnce(() => new Promise(() => {}));

      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.state).toEqual({ status: "loading" });

      mockedApi.post.mockRejectedValue(new ApiError(422, "Auth failed"));

      await act(async () => {
        await call(result.current).catch(() => {});
      });

      expect(result.current.state).toEqual({ status: "unauthenticated" });
    },
  );

  it("retryAuth() from backgroundError state preserves user on repeated failure", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // First retry fails → backgroundError
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Server down"));

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "backgroundError",
        user,
        error: "Server down",
      }),
    );

    // Second retry from backgroundError state also fails → should still preserve user
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Still down"));

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "backgroundError",
        user,
        error: "Still down",
      }),
    );
    consoleSpy.mockRestore();
  });

  it("retryAuth() from refreshing state succeeds and transitions to authenticated", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // First retry fails → backgroundError
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Server down"));

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "backgroundError",
        user,
        error: "Server down",
      }),
    );

    // Second retry: mock a slow response so we can observe refreshing state
    let resolveRetry!: (value: unknown) => void;
    mockedApi.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );

    act(() => {
      result.current.retryAuth();
    });

    // Should be in refreshing state (user preserved from backgroundError)
    expect(result.current.state).toEqual({ status: "refreshing", user });

    // Now resolve — retryAuth from refreshing → authenticated
    const updatedUser = { id: "1", email: "a@b.com", name: "Alice Updated" };
    await act(async () => {
      resolveRetry({ user: updatedUser });
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "authenticated",
        user: updatedUser,
      }),
    );
    consoleSpy.mockRestore();
  });

  it("retryAuth() from authenticated state logs out on 401 (expired session)", async () => {
    localStorage.setItem("token", "valid-token");
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // Session expired — retry gets 401
    mockedApi.get.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));

    act(() => {
      result.current.retryAuth();
    });

    // Should transition through refreshing (not loading) since user existed
    expect(result.current.state).toEqual({ status: "refreshing", user });

    // 401 must clear session — must NOT preserve stale user via backgroundError
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    expect(localStorage.getItem("token")).toBeNull();
  });

  it.each([
    {
      op: "login",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.login("a@b.com", "wrong"),
    },
    {
      op: "register",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.register("taken@b.com", "Bob", "password"),
    },
  ])("$op() failure preserves authenticated state", async ({ call }) => {
    localStorage.setItem("token", "valid-token");
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    mockedApi.post.mockRejectedValue(new ApiError(422, "Auth failed"));

    await expect(act(() => call(result.current))).rejects.toThrow(
      "Auth failed",
    );
    expect(result.current.state).toEqual({ status: "authenticated", user });
  });

  it("retryAuth() from refreshing state logs out on 401 (expired session during refresh)", async () => {
    localStorage.setItem("token", "valid-token");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = { id: "1", email: "a@b.com", name: "Alice" };
    mockedApi.get.mockResolvedValueOnce({ user });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "authenticated", user }),
    );

    // First retry fails with 500 → backgroundError (user preserved)
    mockedApi.get.mockRejectedValueOnce(new ApiError(500, "Server down"));

    act(() => {
      result.current.retryAuth();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "backgroundError",
        user,
        error: "Server down",
      }),
    );

    // Second retry: slow response so we can observe refreshing state
    let rejectRetry!: (err: Error) => void;
    mockedApi.get.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
    );

    act(() => {
      result.current.retryAuth();
    });

    // Should be in refreshing state (user preserved from backgroundError)
    expect(result.current.state).toEqual({ status: "refreshing", user });

    // 401 arrives — must clear session, NOT preserve stale user via backgroundError
    await act(async () => {
      rejectRetry(new ApiError(401, "Unauthorized"));
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unauthenticated" }),
    );
    expect(localStorage.getItem("token")).toBeNull();
    consoleSpy.mockRestore();
  });

  it.each([
    {
      op: "login",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.login("a@b.com", "wrong"),
    },
    {
      op: "register",
      call: (auth: ReturnType<typeof useAuth>) =>
        auth.register("taken@b.com", "Bob", "password"),
    },
  ])(
    "resets refreshing state to unauthenticated when $op() fails during retry",
    async ({ call }) => {
      localStorage.setItem("token", "valid-token");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const user = { id: "1", email: "a@b.com", name: "Alice" };
      mockedApi.get.mockResolvedValueOnce({ user });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() =>
        expect(result.current.state).toEqual({ status: "authenticated", user }),
      );

      let resolveRetry!: (value: unknown) => void;
      mockedApi.get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve;
          }),
      );

      act(() => {
        result.current.retryAuth();
      });

      expect(result.current.state).toEqual({ status: "refreshing", user });

      mockedApi.post.mockRejectedValue(new ApiError(422, "Auth failed"));

      await act(async () => {
        await call(result.current).catch(() => {});
      });

      expect(result.current.state).toEqual({ status: "unauthenticated" });

      await act(async () => {
        resolveRetry({ user });
      });

      expect(result.current.state).toEqual({ status: "unauthenticated" });
      consoleSpy.mockRestore();
    },
  );

  it("useAuth throws outside provider", () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within AuthProvider");
  });

  describe("proactive token refresh", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("refreshes the token on interval while authenticated", async () => {
      localStorage.setItem("token", "valid-token");
      const user = { id: "1", email: "a@b.com", name: "Alice" };
      mockedApi.get.mockResolvedValue({ user });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() =>
        expect(result.current.state).toEqual({ status: "authenticated", user }),
      );

      const refreshedUser = { id: "1", email: "a@b.com", name: "Alice" };
      mockedApi.post.mockResolvedValue({
        token: "refreshed-token",
        user: refreshedUser,
      });

      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      expect(mockedApi.post).toHaveBeenCalledWith("/auth/refresh");
      expect(localStorage.getItem("token")).toBe("refreshed-token");
    });

    it("logs out when refresh returns 401", async () => {
      localStorage.setItem("token", "valid-token");
      const user = { id: "1", email: "a@b.com", name: "Alice" };
      mockedApi.get.mockResolvedValue({ user });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() =>
        expect(result.current.state).toEqual({ status: "authenticated", user }),
      );

      mockedApi.post.mockRejectedValue(new ApiError(401, "invalid token"));

      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      await waitFor(() =>
        expect(result.current.state).toEqual({ status: "unauthenticated" }),
      );
      expect(localStorage.getItem("token")).toBeNull();
    });

    it("does not refresh when unauthenticated", async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.state).toEqual({ status: "unauthenticated" });

      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("clears interval on logout", async () => {
      localStorage.setItem("token", "valid-token");
      const user = { id: "1", email: "a@b.com", name: "Alice" };
      mockedApi.get.mockResolvedValue({ user });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() =>
        expect(result.current.state).toEqual({ status: "authenticated", user }),
      );

      act(() => {
        result.current.logout();
      });

      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      // post should not be called because interval was cleared on logout
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("stays authenticated when refresh fails with non-401 error", async () => {
      localStorage.setItem("token", "valid-token");
      const user = { id: "1", email: "a@b.com", name: "Alice" };
      mockedApi.get.mockResolvedValue({ user });
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() =>
        expect(result.current.state).toEqual({ status: "authenticated", user }),
      );

      mockedApi.post.mockRejectedValue(new ApiError(500, "Server Error"));

      await act(async () => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });

      expect(result.current.state).toEqual({ status: "authenticated", user });
      expect(consoleSpy).toHaveBeenCalledWith(
        "Proactive token refresh failed (will retry next interval):",
        expect.any(ApiError),
      );
      consoleSpy.mockRestore();
    });
  });
});

describe("authReducer", () => {
  const user = { id: "1", email: "a@b.com", name: "Alice" };

  const allStates: AuthState[] = [
    { status: "loading" },
    { status: "unauthenticated" },
    { status: "authenticated", user },
    { status: "error", error: "fail" },
    { status: "backgroundError", user, error: "fail" },
    { status: "refreshing", user },
  ];

  describe("VERIFY_START", () => {
    it.each([
      [{ status: "loading" } as AuthState, { status: "loading" }],
      [{ status: "unauthenticated" } as AuthState, { status: "loading" }],
      [{ status: "error", error: "fail" } as AuthState, { status: "loading" }],
      [
        { status: "authenticated", user } as AuthState,
        { status: "refreshing", user },
      ],
      [
        { status: "backgroundError", user, error: "fail" } as AuthState,
        { status: "refreshing", user },
      ],
      [
        { status: "refreshing", user } as AuthState,
        { status: "refreshing", user },
      ],
    ])("from %j → %j", (state, expected) => {
      expect(authReducer(state, { type: "VERIFY_START" })).toEqual(expected);
    });
  });

  describe("VERIFY_SUCCESS", () => {
    const newUser = { id: "2", email: "b@c.com", name: "Bob" };

    it.each(allStates)("from %j → authenticated with new user", (state) => {
      expect(
        authReducer(state, { type: "VERIFY_SUCCESS", user: newUser }),
      ).toEqual({
        status: "authenticated",
        user: newUser,
      });
    });
  });

  describe("VERIFY_INVALID_RESPONSE", () => {
    it.each(allStates)("from %j → unauthenticated", (state) => {
      expect(authReducer(state, { type: "VERIFY_INVALID_RESPONSE" })).toEqual({
        status: "unauthenticated",
      });
    });
  });

  describe("VERIFY_FAIL", () => {
    it.each([
      [{ status: "loading" } as AuthState, { status: "error", error: "net" }],
      [
        { status: "unauthenticated" } as AuthState,
        { status: "error", error: "net" },
      ],
      [
        { status: "error", error: "old" } as AuthState,
        { status: "error", error: "net" },
      ],
      [
        { status: "authenticated", user } as AuthState,
        { status: "backgroundError", user, error: "net" },
      ],
      [
        { status: "backgroundError", user, error: "old" } as AuthState,
        { status: "backgroundError", user, error: "net" },
      ],
      [
        { status: "refreshing", user } as AuthState,
        { status: "backgroundError", user, error: "net" },
      ],
    ])("from %j → %j", (state, expected) => {
      expect(authReducer(state, { type: "VERIFY_FAIL", error: "net" })).toEqual(
        expected,
      );
    });
  });

  describe("AUTH_SUCCESS", () => {
    const newUser = { id: "2", email: "b@c.com", name: "Bob" };

    it.each(allStates)("from %j → authenticated with new user", (state) => {
      expect(
        authReducer(state, { type: "AUTH_SUCCESS", user: newUser }),
      ).toEqual({
        status: "authenticated",
        user: newUser,
      });
    });
  });

  describe("AUTH_OPERATION_FAILED", () => {
    it("from loading → unauthenticated", () => {
      expect(
        authReducer({ status: "loading" }, { type: "AUTH_OPERATION_FAILED" }),
      ).toEqual({
        status: "unauthenticated",
      });
    });

    it("from refreshing → unauthenticated", () => {
      expect(
        authReducer(
          { status: "refreshing", user },
          { type: "AUTH_OPERATION_FAILED" },
        ),
      ).toEqual({
        status: "unauthenticated",
      });
    });

    it.each([
      { status: "unauthenticated" } as AuthState,
      { status: "authenticated", user } as AuthState,
      { status: "error", error: "fail" } as AuthState,
      { status: "backgroundError", user, error: "fail" } as AuthState,
    ])("from %j → preserves state", (state) => {
      expect(authReducer(state, { type: "AUTH_OPERATION_FAILED" })).toEqual(
        state,
      );
    });
  });

  describe("LOGOUT", () => {
    it.each(allStates)("from %j → unauthenticated", (state) => {
      expect(authReducer(state, { type: "LOGOUT" })).toEqual({
        status: "unauthenticated",
      });
    });
  });
});
