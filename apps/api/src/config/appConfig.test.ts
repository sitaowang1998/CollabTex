import { describe, expect, it } from "vitest";
import { loadConfig } from "./appConfig.js";

describe("loadConfig", () => {
  it("uses safe defaults for optional values", () => {
    expect(
      loadConfig({
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173"
      })
    ).toEqual({
      nodeEnv: "development",
      port: 3000,
      jwtSecret: "test-secret",
      clientOrigin: "http://localhost:5173",
      databaseUrl: undefined
    });
  });

  it("respects explicit env values", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        PORT: "4100",
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:4000",
        DATABASE_URL: "postgres://test"
      })
    ).toEqual({
      nodeEnv: "test",
      port: 4100,
      jwtSecret: "test-secret",
      clientOrigin: "http://localhost:4000",
      databaseUrl: "postgres://test"
    });
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() =>
      loadConfig({
        CLIENT_ORIGIN: "http://localhost:5173"
      })
    ).toThrow("JWT_SECRET is required");
  });

  it("throws when CLIENT_ORIGIN is missing", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "test-secret"
      })
    ).toThrow("CLIENT_ORIGIN is required");
  });

  it("treats blank env values as missing", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "   ",
        CLIENT_ORIGIN: "http://localhost:5173"
      })
    ).toThrow("JWT_SECRET is required");
  });

  it("throws for an invalid port", () => {
    expect(() =>
      loadConfig({
        PORT: "not-a-number",
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173"
      })
    ).toThrow("PORT must be a positive integer");
  });
});
