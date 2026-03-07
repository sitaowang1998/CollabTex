import express from "express";
import type { AppConfig } from "../config/appConfig.js";
import type { AuthService } from "../services/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";

export type HttpAppDependencies = {
  authService: AuthService;
};

export function createHttpApp(
  config: AppConfig,
  dependencies: HttpAppDependencies,
) {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter());
  app.use(createAuthRouter(config, dependencies.authService));
  app.use(errorHandler);

  return app;
}
