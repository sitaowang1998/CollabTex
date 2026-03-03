import type { ErrorRequestHandler } from "express";
import { HttpError } from "../errors/httpError.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  console.error("Unhandled HTTP error", error);
  res.status(500).json({ error: "internal server error" });
};
