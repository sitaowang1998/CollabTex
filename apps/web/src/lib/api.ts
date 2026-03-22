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

  // No special 401 interception (e.g., auto-redirect or token refresh).
  // 401s throw as normal ApiErrors. AuthContext catches 401s from /auth/me
  // to coordinate session cleanup; other 401s are thrown to callers.
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    let fields: Record<string, string> | undefined;

    try {
      const data = await res.json();
      // Handles string errors (per API spec) and structured errors with
      // message + fields (for future validation endpoints).
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
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("PATCH", path, body, options),
  delete: (path: string, options?: RequestOptions): Promise<void> =>
    request<void>("DELETE", path, undefined, options),
};
