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

  switch (error.status) {
    case NETWORK_ERROR_STATUS:
      return "network";
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
