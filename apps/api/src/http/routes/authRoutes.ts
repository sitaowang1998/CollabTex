import { Router } from "express";
import type { LoginRequest, RegisterRequest } from "@collab-tex/shared";
import type { AppConfig } from "../../config/appConfig.js";
import { HttpError } from "../errors/httpError.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import {
  AuthenticatedUserNotFoundError,
  DuplicateEmailError,
  InvalidCredentialsError,
  type AuthService,
} from "../../services/auth.js";

export function createAuthRouter(config: AppConfig, authService: AuthService) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post("/api/auth/register", async (req, res, next) => {
    const body = parseRegisterRequest(req.body);

    if (body instanceof HttpError) {
      next(body);
      return;
    }

    try {
      const response = await authService.register(body);
      res.status(201).json(response);
    } catch (error) {
      next(mapAuthError(error));
    }
  });

  router.post("/api/auth/login", async (req, res, next) => {
    const body = parseLoginRequest(req.body);

    if (body instanceof HttpError) {
      next(body);
      return;
    }

    try {
      const response = await authService.login(body);
      res.json(response);
    } catch (error) {
      next(mapAuthError(error));
    }
  });

  router.get("/api/auth/me", requireAuth, async (req, res, next) => {
    try {
      const authenticatedRequest = req as AuthenticatedRequest;
      const user = await authService.getAuthenticatedUser(
        authenticatedRequest.userId,
      );

      res.json({ user });
    } catch (error) {
      next(mapAuthError(error));
    }
  });

  return router;
}

function parseRegisterRequest(body: unknown): RegisterRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) {
    return new HttpError(400, "email is required");
  }

  if (!name) {
    return new HttpError(400, "name is required");
  }

  if (!password.trim()) {
    return new HttpError(400, "password is required");
  }

  return { email, name, password };
}

function parseLoginRequest(body: unknown): LoginRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) {
    return new HttpError(400, "email is required");
  }

  if (!password.trim()) {
    return new HttpError(400, "password is required");
  }

  return { email, password };
}

function isObject(value: unknown): value is Record<string, string | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapAuthError(error: unknown): Error {
  if (error instanceof DuplicateEmailError) {
    return new HttpError(409, "email already registered");
  }

  if (error instanceof InvalidCredentialsError) {
    return new HttpError(401, "invalid email or password");
  }

  if (error instanceof AuthenticatedUserNotFoundError) {
    return new HttpError(401, "invalid token");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown auth error");
}
