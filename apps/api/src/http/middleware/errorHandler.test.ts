import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors/httpError";
import { errorHandler } from "./errorHandler";

describe("errorHandler", () => {
  it("delegates to the next error handler after headers are sent", () => {
    const error = new Error("boom");
    const next = vi.fn();
    const res = {
      headersSent: true
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
      json
    } as unknown as Response;

    errorHandler(new HttpError(400, "bad request"), {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "bad request" });
  });
});
