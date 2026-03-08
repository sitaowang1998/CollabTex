import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../../config/appConfig.js";
import type { RequestWithUserId } from "../../types/express.js";
import { verifyToken } from "../../services/auth.js";

export function createRequireAuth(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : undefined;

    if (!token) {
      res.status(401).json({ error: "missing token" });
      return;
    }

    try {
      const payload = verifyToken(token, config.jwtSecret);
      const requestWithUserId = req as RequestWithUserId;
      requestWithUserId.userId = payload.sub;
      next();
    } catch (error) {
      if (isJwtValidationError(error)) {
        res.status(401).json({ error: "invalid token" });
        return;
      }

      res.status(401).json({ error: "invalid token" });
    }
  };
}

function isJwtValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "JsonWebTokenError" ||
    error.name === "TokenExpiredError" ||
    error.name === "NotBeforeError" ||
    error.message === "Invalid token payload"
  );
}
