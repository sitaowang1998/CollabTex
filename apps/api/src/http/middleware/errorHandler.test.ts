import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors/httpError.js";
import { errorHandler } from "./errorHandler.js";

describe("errorHandler", () => {
  it("delegates to the next error handler after headers are sent", () => {
    const error = new Error("boom");
    const next = vi.fn();
    const res = {
      headersSent: true,
    } as Response;

    errorHandler(error, {} as never, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("serializes HttpError responses", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = {
      headersSent: false,
      status,
      json,
    } as unknown as Response;

    errorHandler(new HttpError(400, "bad request"), {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "bad request" });
  });

  it("handles generic errors by returning 500 internal server error", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = {
      headersSent: false,
      status,
      json,
    } as unknown as Response;
    const error = new Error("unexpected error");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      errorHandler(error, {} as never, res, vi.fn());

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Unhandled HTTP error",
        error,
      );
      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: "internal server error" });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
