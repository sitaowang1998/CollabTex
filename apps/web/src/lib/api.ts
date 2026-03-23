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

const AUTH_PATHS = new Set([
  "/auth/refresh",
  "/auth/login",
  "/auth/register",
  "/auth/me",
]);

let refreshInFlight: Promise<string> | null = null;

async function attemptTokenRefresh(): Promise<string> {
  const data = await request<AuthResponse>("POST", "/auth/refresh");
  if (!data.token) {
    throw new ApiError(0, "Invalid refresh response: missing token");
  }
  localStorage.setItem("token", data.token);
  return data.token;
}

export type RequestOptions = {
  signal?: AbortSignal;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
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
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
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
  if (res.status === 401 && !AUTH_PATHS.has(path) && token) {
    const currentToken = localStorage.getItem("token");
    let retryToken: string | undefined;

    if (currentToken && currentToken !== token) {
      // Another request already refreshed — retry with the new token directly.
      retryToken = currentToken;
    } else if (currentToken === token) {
      // Token unchanged — perform a refresh-and-retry.
      let isInitiator = false;
      try {
        if (!refreshInFlight) {
          refreshInFlight = attemptTokenRefresh();
          isInitiator = true;
        }
        retryToken = await refreshInFlight;
      } catch (refreshErr) {
        console.warn("Token refresh failed during 401 recovery:", refreshErr);
        localStorage.removeItem("token");
      } finally {
        if (isInitiator) refreshInFlight = null;
      }
    }
    // If !currentToken (logged out), skip refresh entirely.

    if (retryToken) {
      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${retryToken}`,
      };
      if (body !== undefined) {
        retryHeaders["Content-Type"] = "application/json";
      }

      try {
        res = await fetch(`${BASE_URL}${path}`, {
          method,
          headers: retryHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: options?.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
            : AbortSignal.timeout(30_000),
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
    if (method === "DELETE" || method === "PATCH" || method === "PUT")
      return undefined as T;
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
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  delete: (
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<void> => request<void>("DELETE", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PUT", path, body, options),
};
