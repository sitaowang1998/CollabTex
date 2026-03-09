import { Router } from "express";
import type { LoginRequest, RegisterRequest } from "@collab-tex/shared";
import type { AppConfig } from "../../config/appConfig.js";
import { HttpError } from "../errors/httpError.js";
import { isObject, parseEmail } from "../validation/requestValidation.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import {
  AuthenticatedUserNotFoundError,
  DuplicateEmailError,
  InvalidCredentialsError,
  type AuthService,
} from "../../services/auth.js";

const MAX_USER_NAME_LENGTH = 120;

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

  const email = parseEmail(body.email);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (email instanceof HttpError) {
    return email;
  }

  if (!name) {
    return new HttpError(400, "name is required");
  }

  if (name.length > MAX_USER_NAME_LENGTH) {
    return new HttpError(
      400,
      `name must be at most ${MAX_USER_NAME_LENGTH} characters`,
    );
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

  const email = parseEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (email instanceof HttpError) {
    return email;
  }

  if (!password.trim()) {
    return new HttpError(400, "password is required");
  }

  return { email, password };
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
