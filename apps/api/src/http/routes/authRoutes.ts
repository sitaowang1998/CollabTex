import { Router } from "express";
import type { LoginResponse } from "@collab-tex/shared";
import type { AppConfig } from "../../config/appConfig";
import { signToken } from "../../services/auth";
import type { AuthenticatedRequest } from "../../types/express";
import { createRequireAuth } from "../middleware/requireAuth";

export function createAuthRouter(config: AppConfig) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post("/api/login", (req, res) => {
    const { username } = req.body as { username?: string };
    if (!username) {
      res.status(400).json({ error: "username required" });
      return;
    }

    const token = signToken(username, config.jwtSecret);
    const response: LoginResponse = { token };

    res.json(response);
  });

  router.get("/api/me", requireAuth, (req, res) => {
    const authenticatedRequest = req as AuthenticatedRequest;
    res.json({ userId: authenticatedRequest.userId });
  });

  return router;
}
