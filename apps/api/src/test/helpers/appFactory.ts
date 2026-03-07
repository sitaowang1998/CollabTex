import { createHttpApp } from "../../http/app.js";
import type { AppConfig } from "../../config/appConfig.js";

const INVALID_TEST_DATABASE_URL =
  "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 0,
  jwtSecret: "test_secret",
  clientOrigin: "http://localhost:5173",
  databaseUrl: INVALID_TEST_DATABASE_URL,
};

export function createTestApp() {
  return createHttpApp(testConfig);
}
