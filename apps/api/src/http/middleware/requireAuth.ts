import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../../config/appConfig";
import type { RequestWithUserId } from "../../types/express";
import { verifyToken } from "../../services/auth";

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
    } catch {
      res.status(401).json({ error: "invalid token" });
    }
  };
}
