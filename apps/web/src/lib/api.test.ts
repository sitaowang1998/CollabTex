import { api, ApiError, NETWORK_ERROR_STATUS } from "./api";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Error",
    json: () => Promise.resolve(body),
  };
}

describe("api", () => {
  it("sends GET request with correct method and path", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: 1 }));
    await api.get("/test");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        method: "GET",
        headers: {},
        body: undefined,
      }),
    );
  });

  it("attaches Bearer token from localStorage", async () => {
    localStorage.setItem("token", "my-token");
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.get("/test");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
        }),
      }),
    );
  });

  it("omits Authorization header when no token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.get("/test");
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("sends POST with JSON body and Content-Type", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.post("/items", { name: "test" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/items",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      }),
    );
  });

  it("sends POST without body and omits Content-Type", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.post("/endpoint");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/endpoint",
      expect.objectContaining({
        method: "POST",
        headers: {},
        body: undefined,
      }),
    );
  });

  it("sends PATCH with JSON body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 1, name: "updated" }));
    const result = await api.patch("/items/1", { name: "updated" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "updated" }),
      }),
    );
    expect(result).toEqual({ id: 1, name: "updated" });
  });

  it("sends DELETE with correct method", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    });
    await api.delete("/items/1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({
        method: "DELETE",
        headers: {},
        body: undefined,
      }),
    );
  });

  it("parses and returns JSON response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 1, name: "test" }));
    const result = await api.get("/items/1");
    expect(result).toEqual({ id: 1, name: "test" });
  });

  it("returns undefined for 204 response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    });
    const result = await api.delete("/items/1");
    expect(result).toBeUndefined();
  });

  it("throws ApiError with message from error string body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "Not found" }, 404));
    await expect(api.get("/missing")).rejects.toMatchObject({
      status: 404,
      message: "Not found",
    });
  });

  it("throws ApiError with fields from structured error body", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Validation failed",
            fields: { email: "Invalid email" },
          },
        },
        422,
      ),
    );
    await expect(api.post("/register", {})).rejects.toMatchObject({
      status: 422,
      message: "Validation failed",
      fields: { email: "Invalid email" },
    });
  });

  it("falls back to statusText when structured error has no message", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: { fields: { email: "bad" } } }, 422),
    );
    await expect(api.post("/register", {})).rejects.toMatchObject({
      status: 422,
      message: "Error",
      fields: { email: "bad" },
    });
  });

  it("throws ApiError on 401 when refresh also fails", async () => {
    localStorage.setItem("token", "old-token");

    // Original request: 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "Token expired" }, 401),
    );
    // Refresh attempt: also 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );

    await expect(api.get("/secret")).rejects.toMatchObject({
      status: 401,
      message: "Token expired",
    });
  });

  it("falls back to statusText for non-JSON error body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    await expect(api.get("/broken")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });

  it("uses fallback message when statusText is empty (HTTP/2)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    await expect(api.get("/broken")).rejects.toMatchObject({
      status: 500,
      message: "Request failed (500)",
    });
  });

  it("throws ApiError with original error message on network failure", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/offline")).rejects.toMatchObject({
      status: NETWORK_ERROR_STATUS,
      message: "Failed to fetch",
    });
  });

  it("falls back to 'Network error' for non-Error thrown values", async () => {
    mockFetch.mockRejectedValue("connection refused");
    await expect(api.get("/offline")).rejects.toMatchObject({
      status: NETWORK_ERROR_STATUS,
      message: "Network error",
    });
  });

  it("preserves original error as cause on network failure", async () => {
    const original = new TypeError("Failed to fetch");
    mockFetch.mockRejectedValue(original);
    const error = await api.get("/offline").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).cause).toBe(original);
  });

  it("wraps non-SyntaxError from error response JSON parsing in ApiError", async () => {
    const cause = new TypeError("Cannot read properties");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(cause),
    });
    const error = await api.get("/broken").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
    expect((error as ApiError).cause).toBe(cause);
  });

  it("rethrows non-SyntaxError from success response JSON parsing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new TypeError("Cannot read properties")),
    });
    await expect(api.get("/broken")).rejects.toBeInstanceOf(TypeError);
  });

  it("passes an AbortSignal timeout to fetch", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get("/test");
    const options = mockFetch.mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns undefined for PATCH 204 response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    });
    const result = await api.patch("/projects/1/nodes/move", { parentId: "2" });
    expect(result).toBeUndefined();
  });

  it("throws ApiError on GET 204 response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    });
    await expect(api.get("/items")).rejects.toMatchObject({
      status: 204,
      message: expect.stringContaining("Unexpected empty response"),
    });
  });

  it("throws ApiError on POST 204 response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    });
    await expect(api.post("/items", {})).rejects.toMatchObject({
      status: 204,
      message: expect.stringContaining("Unexpected empty response"),
    });
  });

  it("throws ApiError when success response has malformed JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    const error = await api.get("/bad-json").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 200,
      message: "Invalid response format",
    });
  });
});

describe("401 refresh interceptor", () => {
  it("retries the request after a successful token refresh", async () => {
    localStorage.setItem("token", "old-token");

    // Original: 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );
    // Refresh: success
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        token: "new-token",
        user: { id: "u1", email: "a@b.com", name: "A" },
      }),
    );
    // Retry: success
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: "hello" }));

    const result = await api.get<{ data: string }>("/projects");

    expect(result).toEqual({ data: "hello" });
    expect(localStorage.getItem("token")).toBe("new-token");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify retry used the new token
    const retryHeaders = mockFetch.mock.calls[2][1].headers;
    expect(retryHeaders.Authorization).toBe("Bearer new-token");
  });

  it("does not attempt refresh for /auth/login", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid email or password" }, 401),
    );

    await expect(
      api.post("/auth/login", { email: "a@b.com", password: "wrong" }),
    ).rejects.toMatchObject({ status: 401 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh for /auth/register", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "invalid" }, 401));

    await expect(
      api.post("/auth/register", {
        email: "a@b.com",
        name: "A",
        password: "p",
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh for /auth/me", async () => {
    localStorage.setItem("token", "old-token");
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );

    await expect(api.get("/auth/me")).rejects.toMatchObject({
      status: 401,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh for /auth/refresh", async () => {
    localStorage.setItem("token", "old-token");
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );

    await expect(api.post("/auth/refresh")).rejects.toMatchObject({
      status: 401,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent refresh attempts", async () => {
    localStorage.setItem("token", "old-token");

    // Both original requests: 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );
    // Single refresh call: success
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        token: "new-token",
        user: { id: "u1", email: "a@b.com", name: "A" },
      }),
    );
    // Both retries: success
    mockFetch.mockResolvedValueOnce(jsonResponse({ a: 1 }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ b: 2 }));

    const [r1, r2] = await Promise.all([
      api.get<{ a: number }>("/items/1"),
      api.get<{ b: number }>("/items/2"),
    ]);

    expect(r1).toEqual({ a: 1 });
    expect(r2).toEqual({ b: 2 });
    // 2 originals + 1 shared refresh + 2 retries = 5
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("retries POST with body after refresh", async () => {
    localStorage.setItem("token", "old-token");

    // Original POST: 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );
    // Refresh: success
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        token: "new-token",
        user: { id: "u1", email: "a@b.com", name: "A" },
      }),
    );
    // Retry POST: success
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42 }));

    const result = await api.post<{ id: number }>("/items", { name: "test" });

    expect(result).toEqual({ id: 42 });

    // Verify retry preserved body and Content-Type
    const [retryUrl, retryInit] = mockFetch.mock.calls[2];
    expect(retryUrl).toBe("/api/items");
    expect(retryInit.method).toBe("POST");
    expect(retryInit.body).toBe(JSON.stringify({ name: "test" }));
    expect(retryInit.headers["Content-Type"]).toBe("application/json");
    expect(retryInit.headers.Authorization).toBe("Bearer new-token");
  });

  it("propagates network error from retry fetch (not stale 401)", async () => {
    localStorage.setItem("token", "old-token");

    // Original: 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );
    // Refresh: success
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        token: "new-token",
        user: { id: "u1", email: "a@b.com", name: "A" },
      }),
    );
    // Retry: network failure
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await api.get("/projects").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(NETWORK_ERROR_STATUS);
    expect((error as ApiError).message).toBe("Failed to fetch");
  });
});

describe("uploadFile", () => {
  const testFile = new File(["content"], "photo.png", { type: "image/png" });

  it("sends FormData with Authorization header and no Content-Type", async () => {
    localStorage.setItem("token", "my-token");
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    await api.uploadFile("/projects/p1/files/f1/content", testFile);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/projects/p1/files/f1/content");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(testFile);
    expect(init.headers.Authorization).toBe("Bearer my-token");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("resolves on 204 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    await expect(
      api.uploadFile("/projects/p1/files/f1/content", testFile),
    ).resolves.toBeUndefined();
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "file exceeds maximum size of 50 MB" }, 413),
    );

    const error = await api
      .uploadFile("/projects/p1/files/f1/content", testFile)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).message).toBe(
      "file exceeds maximum size of 50 MB",
    );
  });

  it("throws ApiError on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await api
      .uploadFile("/projects/p1/files/f1/content", testFile)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(NETWORK_ERROR_STATUS);
  });

  it("retries after 401 token refresh", async () => {
    localStorage.setItem("token", "old-token");

    // Original: 401
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "invalid token" }, 401),
    );
    // Refresh: success
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        token: "new-token",
        user: { id: "u1", email: "a@b.com", name: "A" },
      }),
    );
    // Retry: success
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    await api.uploadFile("/projects/p1/files/f1/content", testFile);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const retryHeaders = mockFetch.mock.calls[2][1].headers;
    expect(retryHeaders.Authorization).toBe("Bearer new-token");
  });

  it("falls back to statusText for non-JSON error body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    const error = await api
      .uploadFile("/projects/p1/files/f1/content", testFile)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toBe("Bad Gateway");
  });

  it("re-throws non-SyntaxError from error response JSON parsing", async () => {
    const cause = new TypeError("Cannot read properties");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(cause),
    });

    const error = await api
      .uploadFile("/projects/p1/files/f1/content", testFile)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toBe("Internal Server Error");
    expect((error as ApiError).cause).toBe(cause);
  });
});
