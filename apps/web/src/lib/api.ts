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

function wrapNetworkError(err: unknown): never {
  throw new ApiError(
    NETWORK_ERROR_STATUS,
    err instanceof Error ? err.message : "Network error",
    undefined,
    { cause: err },
  );
}

function buildSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  return userSignal
    ? AbortSignal.any([userSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

async function tryRefreshToken(
  path: string,
  originalToken: string,
): Promise<string | undefined> {
  if (AUTH_PATHS.has(path)) return undefined;

  const currentToken = localStorage.getItem("token");

  if (currentToken && currentToken !== originalToken) {
    return currentToken;
  }

  if (currentToken === originalToken) {
    let isInitiator = false;
    try {
      if (!refreshInFlight) {
        refreshInFlight = attemptTokenRefresh();
        isInitiator = true;
      }
      return await refreshInFlight;
    } catch (refreshErr) {
      console.warn("Token refresh failed during 401 recovery:", refreshErr);
      localStorage.removeItem("token");
    } finally {
      if (isInitiator) refreshInFlight = null;
    }
  }

  return undefined;
}

async function parseErrorResponse(res: Response): Promise<never> {
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

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    wrapNetworkError(err);
  }
}

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

  const signal = buildSignal(options?.signal, 30_000);
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;

  let res = await safeFetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: serializedBody,
    signal,
  });

  // On 401, attempt a single token refresh and retry — but not for auth
  // endpoints themselves (to avoid infinite loops).
  if (res.status === 401 && token) {
    const retryToken = await tryRefreshToken(path, token);

    if (retryToken) {
      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${retryToken}`,
      };
      if (body !== undefined) {
        retryHeaders["Content-Type"] = "application/json";
      }

      res = await safeFetch(`${BASE_URL}${path}`, {
        method,
        headers: retryHeaders,
        body: serializedBody,
        signal: buildSignal(options?.signal, 30_000),
      });
    }
  }

  if (!res.ok) {
    await parseErrorResponse(res);
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

async function getBlob(path: string, options?: RequestOptions): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const signal = buildSignal(options?.signal, 30_000);

  let res = await safeFetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers,
    signal,
  });

  if (res.status === 401 && token) {
    const retryToken = await tryRefreshToken(path, token);
    if (retryToken) {
      res = await safeFetch(`${BASE_URL}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${retryToken}` },
        signal: buildSignal(options?.signal, 30_000),
      });
    }
  }

  if (!res.ok) {
    await parseErrorResponse(res);
  }

  return res.blob();
}

async function uploadFile(
  path: string,
  file: File,
  options?: RequestOptions,
): Promise<void> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const timeoutMs = 120_000;

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.append("file", file);
    return fd;
  }

  let res = await safeFetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: buildFormData(),
    signal: buildSignal(options?.signal, timeoutMs),
  });

  if (res.status === 401 && token) {
    const retryToken = await tryRefreshToken(path, token);

    if (retryToken) {
      res = await safeFetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${retryToken}` },
        body: buildFormData(),
        signal: buildSignal(options?.signal, timeoutMs),
      });
    }
  }

  if (!res.ok) {
    await parseErrorResponse(res);
  }
}

async function uploadBinaryFile<T>(
  path: string,
  file: File,
  filePath: string,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const timeoutMs = 120_000;

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("path", filePath);
    if (file.type) {
      fd.append("mime", file.type);
    }
    return fd;
  }

  let res = await safeFetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: buildFormData(),
    signal: buildSignal(options?.signal, timeoutMs),
  });

  if (res.status === 401 && token) {
    const retryToken = await tryRefreshToken(path, token);
    if (retryToken) {
      headers["Authorization"] = `Bearer ${retryToken}`;
      res = await safeFetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: buildFormData(),
        signal: buildSignal(options?.signal, timeoutMs),
      });
    }
  }

  if (!res.ok) {
    await parseErrorResponse(res);
  }

  return res.json() as Promise<T>;
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
  getBlob,
  uploadFile,
  uploadBinaryFile,
};
