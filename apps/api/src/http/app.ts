import express from "express";
import type { AppConfig } from "../config/appConfig.js";
import type { AuthService } from "../services/auth.js";
import type { ProjectService } from "../services/project.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";
import { createProjectRouter } from "./routes/projectRoutes.js";

export type HttpAppDependencies = {
  authService: AuthService;
  projectService: ProjectService;
};

export function createHttpApp(
  config: AppConfig,
  dependencies: HttpAppDependencies,
) {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter());
  app.use(createAuthRouter(config, dependencies.authService));
  app.use(createProjectRouter(config, dependencies.projectService));
  app.use(errorHandler);

  return app;
}
