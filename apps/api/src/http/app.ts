import express from "express";
import type { AppConfig } from "../config/appConfig";
import { errorHandler } from "./middleware/errorHandler";
import { createAuthRouter } from "./routes/authRoutes";
import { createHealthRouter } from "./routes/healthRoutes";

export function createHttpApp(config: AppConfig) {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter());
  app.use(createAuthRouter(config));
  app.use(errorHandler);

  return app;
}
