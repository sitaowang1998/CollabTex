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

  it("throws ApiError with server message on 401 without side effects", async () => {
    localStorage.setItem("token", "old-token");

    mockFetch.mockResolvedValue(jsonResponse({ error: "Token expired" }, 401));

    await expect(api.get("/secret")).rejects.toMatchObject({
      status: 401,
      message: "Token expired",
    });
    // api.ts should NOT clear localStorage or redirect — that's AuthContext's job
    expect(localStorage.getItem("token")).toBe("old-token");
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
