import {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type {
  AuthUser,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
} from "@collab-tex/shared";
import { api, ApiError } from "../lib/api";
import { AuthContext, authReducer, type AuthState } from "./AuthContextDef";

const initialState = (hasToken: boolean): AuthState =>
  hasToken ? { status: "loading" } : { status: "unauthenticated" };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    authReducer,
    localStorage.getItem("token") !== null,
    initialState,
  );
  // Each verifyAuth call captures its own { cancelled: boolean } object.
  // login/register/logout cancel in-flight verification by setting cancelled = true;
  // retryAuth cancels AND starts a new request by assigning a fresh object.
  const cancelledRef = useRef({ cancelled: false });

  const verifyAuth = useCallback((cancelled: { cancelled: boolean }) => {
    api
      .get<{ user: AuthUser }>("/auth/me")
      .then((data) => {
        if (cancelled.cancelled) return;
        if (!data.user) {
          console.warn(
            "GET /auth/me returned 200 but no user data. Possible API contract mismatch.",
            data,
          );
          localStorage.removeItem("token");
          dispatch({ type: "VERIFY_INVALID_RESPONSE" });
          return;
        }
        dispatch({ type: "VERIFY_SUCCESS", user: data.user });
      })
      .catch((error: unknown) => {
        if (cancelled.cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          // Token rejected — no valid session
          localStorage.removeItem("token");
          dispatch({ type: "VERIFY_INVALID_RESPONSE" });
        } else {
          console.error("Failed to verify authentication:", error);
          const msg =
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : "An unknown error occurred";
          dispatch({ type: "VERIFY_FAIL", error: msg });
        }
      });
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const cancelled = { cancelled: false };
    cancelledRef.current = cancelled;

    if (!storedToken) {
      // Token absent — may have been cleared between render and effect
      dispatch({ type: "VERIFY_INVALID_RESPONSE" });
    } else {
      verifyAuth(cancelled);
    }

    return () => {
      cancelledRef.current.cancelled = true;
    };
  }, [verifyAuth]);

  /** @throws {ApiError} Callers must catch — auth failure is re-thrown after dispatching. */
  const login = useCallback(async (email: string, password: string) => {
    cancelledRef.current.cancelled = true;
    try {
      const data = await api.post<AuthResponse>("/auth/login", {
        email,
        password,
      } satisfies LoginRequest);
      if (!data.token || !data.user) {
        throw new ApiError(0, "Invalid server response: missing token or user");
      }
      localStorage.setItem("token", data.token);
      dispatch({ type: "AUTH_SUCCESS", user: data.user });
    } catch (error) {
      dispatch({ type: "AUTH_OPERATION_FAILED" });
      throw error;
    }
  }, []);

  /** @throws {ApiError} Callers must catch — auth failure is re-thrown after dispatching. */
  const register = useCallback(
    async (email: string, name: string, password: string) => {
      cancelledRef.current.cancelled = true;
      try {
        const data = await api.post<AuthResponse>("/auth/register", {
          email,
          name,
          password,
        } satisfies RegisterRequest);
        if (!data.token || !data.user) {
          throw new ApiError(
            0,
            "Invalid server response: missing token or user",
          );
        }
        localStorage.setItem("token", data.token);
        dispatch({ type: "AUTH_SUCCESS", user: data.user });
      } catch (error) {
        dispatch({ type: "AUTH_OPERATION_FAILED" });
        throw error;
      }
    },
    [],
  );

  const retryAuth = useCallback(() => {
    if (!localStorage.getItem("token")) {
      dispatch({ type: "LOGOUT" });
      return;
    }
    cancelledRef.current.cancelled = true;
    const cancelled = { cancelled: false };
    cancelledRef.current = cancelled;
    dispatch({ type: "VERIFY_START" });
    verifyAuth(cancelled);
  }, [verifyAuth]);

  const logout = useCallback(() => {
    cancelledRef.current.cancelled = true;
    localStorage.removeItem("token");
    dispatch({ type: "LOGOUT" });
  }, []);

  const value = useMemo(
    () => ({ state, login, register, logout, retryAuth }),
    [state, login, register, logout, retryAuth],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
