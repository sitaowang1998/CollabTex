import { describe, expect, it } from "vitest";
import { loadConfig } from "./appConfig";

describe("loadConfig", () => {
  it("uses defaults when env is missing", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      jwtSecret: "dev_secret_change_me",
      clientOrigin: "http://localhost:5173",
      databaseUrl: undefined
    });
  });

  it("respects explicit env values", () => {
    expect(
      loadConfig({
        PORT: "4100",
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:4000",
        DATABASE_URL: "postgres://test"
      })
    ).toEqual({
      port: 4100,
      jwtSecret: "test-secret",
      clientOrigin: "http://localhost:4000",
      databaseUrl: "postgres://test"
    });
  });

  it("throws for an invalid port", () => {
    expect(() => loadConfig({ PORT: "not-a-number" })).toThrow(
      "PORT must be a positive integer"
    );
  });
});
