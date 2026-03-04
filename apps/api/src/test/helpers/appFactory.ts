import { createHttpApp } from "../../http/app.js";
import type { AppConfig } from "../../config/appConfig.js";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 0,
  jwtSecret: "test_secret",
  clientOrigin: "http://localhost:5173"
};

export function createTestApp() {
  return createHttpApp(testConfig);
}
