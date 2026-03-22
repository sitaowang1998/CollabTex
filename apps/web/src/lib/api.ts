import type { AuthResponse } from "@collab-tex/shared";

const BASE_URL = "/api";

export const NETWORK_ERROR_STATUS = 0 as const;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Readonly<Record<string, string>>,
    options?: { cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "ApiError";
  }
}

const AUTH_PATHS = new Set(["/auth/refresh", "/auth/login", "/auth/register"]);

let refreshInFlight: Promise<string> | null = null;

async function attemptTokenRefresh(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new ApiError(res.status, "Token refresh failed");
  }

  const data = (await res.json()) as AuthResponse;
  localStorage.setItem("token", data.token);
  return data.token;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};

  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ApiError(
      NETWORK_ERROR_STATUS,
      err instanceof Error ? err.message : "Network error",
      undefined,
      { cause: err },
    );
  }

  // On 401, attempt a single token refresh and retry — but not for auth
  // endpoints themselves (to avoid infinite loops).
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    let newToken: string | undefined;
    try {
      if (!refreshInFlight) {
        refreshInFlight = attemptTokenRefresh();
      }
      newToken = await refreshInFlight;
    } catch (refreshErr) {
      console.warn("Token refresh failed during 401 recovery:", refreshErr);
    } finally {
      refreshInFlight = null;
    }

    if (newToken) {
      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${newToken}`,
      };
      if (body !== undefined) {
        retryHeaders["Content-Type"] = "application/json";
      }

      try {
        res = await fetch(`${BASE_URL}${path}`, {
          method,
          headers: retryHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        throw new ApiError(
          NETWORK_ERROR_STATUS,
          err instanceof Error ? err.message : "Network error",
          undefined,
          { cause: err },
        );
      }
    }
  }

  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    let fields: Record<string, string> | undefined;

    try {
      const data = await res.json();
      if (data.error) {
        if (typeof data.error === "string") {
          message = data.error;
        } else {
          message =
            data.error.message ??
            (res.statusText || `Request failed (${res.status})`);
          fields = data.error.fields;
        }
      }
    } catch (e) {
      if (!(e instanceof SyntaxError))
        throw new ApiError(
          res.status,
          res.statusText || `Request failed (${res.status})`,
          undefined,
          { cause: e },
        );
      // body wasn't JSON, use statusText
    }

    throw new ApiError(res.status, message, fields);
  }

  if (res.status === 204) {
    // DELETE and some PATCH endpoints return 204 per API spec; other methods indicate a mismatch.
    if (method === "DELETE" || method === "PATCH") return undefined as T;
    throw new ApiError(204, `Unexpected empty response from ${method} ${path}`);
  }

  try {
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new ApiError(res.status, "Invalid response format", undefined, {
        cause: e,
      });
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: (path: string): Promise<void> => request<void>("DELETE", path),
};
