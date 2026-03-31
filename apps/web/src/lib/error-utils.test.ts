import { ApiError, NETWORK_ERROR_STATUS } from "./api";
import {
  categorizeApiError,
  errorCategoryToIcon,
  type ErrorCategory,
} from "./error-utils";

describe("categorizeApiError", () => {
  it("returns 'network' for network errors", () => {
    expect(
      categorizeApiError(new ApiError(NETWORK_ERROR_STATUS, "Network error")),
    ).toBe("network");
  });

  it("returns 'auth' for 401", () => {
    expect(categorizeApiError(new ApiError(401, "Unauthorized"))).toBe("auth");
  });

  it("returns 'forbidden' for 403", () => {
    expect(categorizeApiError(new ApiError(403, "Forbidden"))).toBe(
      "forbidden",
    );
  });

  it("returns 'not-found' for 404", () => {
    expect(categorizeApiError(new ApiError(404, "Not found"))).toBe(
      "not-found",
    );
  });

  it("returns 'validation' for 400", () => {
    expect(categorizeApiError(new ApiError(400, "Bad request"))).toBe(
      "validation",
    );
  });

  it("returns 'conflict' for 409", () => {
    expect(categorizeApiError(new ApiError(409, "Conflict"))).toBe("conflict");
  });

  it("returns 'payload' for 413", () => {
    expect(categorizeApiError(new ApiError(413, "Too large"))).toBe("payload");
  });

  it("returns 'server' for 500", () => {
    expect(categorizeApiError(new ApiError(500, "Internal error"))).toBe(
      "server",
    );
  });

  it("returns 'server' for 502", () => {
    expect(categorizeApiError(new ApiError(502, "Bad gateway"))).toBe("server");
  });

  it("returns 'unknown' for unhandled 4xx status", () => {
    expect(categorizeApiError(new ApiError(418, "Teapot"))).toBe("unknown");
  });

  it("returns 'unknown' for non-ApiError", () => {
    expect(categorizeApiError(new Error("generic"))).toBe("unknown");
  });

  it("returns 'unknown' for non-Error values", () => {
    expect(categorizeApiError("string error")).toBe("unknown");
    expect(categorizeApiError(null)).toBe("unknown");
  });
});

describe("errorCategoryToIcon", () => {
  const expectedMappings: [ErrorCategory, string][] = [
    ["network", "network"],
    ["auth", "auth"],
    ["not-found", "not-found"],
    ["forbidden", "forbidden"],
    ["server", "server"],
    ["validation", "generic"],
    ["conflict", "generic"],
    ["payload", "generic"],
    ["unknown", "generic"],
  ];

  it.each(expectedMappings)(
    "maps '%s' to '%s' icon",
    (category, expectedIcon) => {
      expect(errorCategoryToIcon(category)).toBe(expectedIcon);
    },
  );
});
