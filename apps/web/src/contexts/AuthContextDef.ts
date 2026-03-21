import { createContext } from "react";
import type { AuthUser } from "@collab-tex/shared";

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" }
  | { status: "error"; error: string }
  | { status: "backgroundError"; user: AuthUser; error: string }
  | { status: "refreshing"; user: AuthUser };

export type AuthAction =
  | { type: "VERIFY_START" }
  | { type: "VERIFY_SUCCESS"; user: AuthUser }
  | { type: "VERIFY_INVALID_RESPONSE" }
  | { type: "VERIFY_FAIL"; error: string }
  | { type: "AUTH_SUCCESS"; user: AuthUser }
  | { type: "AUTH_OPERATION_FAILED" }
  | { type: "LOGOUT" };

function extractUser(state: AuthState): AuthUser | undefined {
  switch (state.status) {
    case "authenticated":
    case "backgroundError":
    case "refreshing":
      return state.user;
    default:
      return undefined;
  }
}

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "VERIFY_START": {
      const user = extractUser(state);
      return user ? { status: "refreshing", user } : { status: "loading" };
    }
    case "VERIFY_SUCCESS":
      return { status: "authenticated", user: action.user };
    case "VERIFY_INVALID_RESPONSE":
      return { status: "unauthenticated" };
    case "VERIFY_FAIL": {
      const user = extractUser(state);
      return user
        ? { status: "backgroundError", user, error: action.error }
        : { status: "error", error: action.error };
    }
    case "AUTH_SUCCESS":
      return { status: "authenticated", user: action.user };
    // Resets loading/refreshing (would leave UI stuck) but preserves
    // authenticated/backgroundError/error (existing session or error stays visible).
    case "AUTH_OPERATION_FAILED":
      return state.status === "loading" || state.status === "refreshing"
        ? { status: "unauthenticated" }
        : state;
    case "LOGOUT":
      return { status: "unauthenticated" };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export interface AuthContextValue {
  state: AuthState;
  /** @throws {ApiError} on invalid credentials or network failure */
  login: (email: string, password: string) => Promise<void>;
  /** @throws {ApiError} on validation failure or network failure */
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
  retryAuth: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
