import type { ErrorBlockIcon } from "@/components/ui/error-block";
import { ApiError, NETWORK_ERROR_STATUS } from "./api";

export type ErrorCategory =
  | "network"
  | "auth"
  | "not-found"
  | "forbidden"
  | "validation"
  | "conflict"
  | "payload"
  | "server"
  | "unknown";

export function categorizeApiError(error: unknown): ErrorCategory {
  if (!(error instanceof ApiError)) return "unknown";

  // Status 0 is used for both real network failures (via wrapNetworkError,
  // which sets cause) and non-network client errors (e.g., invalid token
  // responses). Only classify as "network" when cause is present.
  if (error.status === NETWORK_ERROR_STATUS) {
    return error.cause instanceof Error ? "network" : "unknown";
  }

  switch (error.status) {
    case 401:
      return "auth";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 400:
      return "validation";
    case 409:
      return "conflict";
    case 413:
      return "payload";
    default:
      return error.status >= 500 ? "server" : "unknown";
  }
}

const categoryToIcon: Record<ErrorCategory, ErrorBlockIcon> = {
  network: "network",
  auth: "auth",
  "not-found": "not-found",
  forbidden: "forbidden",
  validation: "generic",
  conflict: "generic",
  payload: "generic",
  server: "server",
  unknown: "generic",
};

export function errorCategoryToIcon(category: ErrorCategory): ErrorBlockIcon {
  return categoryToIcon[category];
}
