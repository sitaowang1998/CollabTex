import express from "express";
import type { AppConfig } from "../config/appConfig.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";

export function createHttpApp(config: AppConfig) {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter());
  app.use(createAuthRouter(config));
  app.use(errorHandler);

  return app;
}
