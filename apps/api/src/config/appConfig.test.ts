import { describe, expect, it } from "vitest";
import { loadConfig } from "./appConfig.js";

const INVALID_TEST_DATABASE_URL =
  "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public";

describe("loadConfig", () => {
  it("uses safe defaults for NODE_ENV and PORT when required env values are provided", () => {
    expect(
      loadConfig({
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173",
        DATABASE_URL: INVALID_TEST_DATABASE_URL,
      }),
    ).toEqual({
      nodeEnv: "development",
      port: 3000,
      jwtSecret: "test-secret",
      clientOrigin: "http://localhost:5173",
      databaseUrl: INVALID_TEST_DATABASE_URL,
      snapshotStorageRoot: "var/snapshots",
      compileStorageRoot: "var/compiles",
      binaryContentStorageRoot: "var/binary-content",
      compileTimeoutMs: 60000,
      compileDockerImage: "texlive/texlive:latest-small",
      shutdownDrainTimeoutMs: 5000,
    });
  });

  it("respects explicit env values", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        PORT: "4100",
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:4000",
        DATABASE_URL: INVALID_TEST_DATABASE_URL,
        SNAPSHOT_STORAGE_ROOT: "tmp/snapshots",
        COMPILE_STORAGE_ROOT: "tmp/compiles",
        BINARY_CONTENT_STORAGE_ROOT: "tmp/binary-content",
        COMPILE_TIMEOUT_MS: "120000",
        COMPILE_DOCKER_IMAGE: "texlive/texlive:2024",
        SHUTDOWN_DRAIN_TIMEOUT_MS: "10000",
      }),
    ).toEqual({
      nodeEnv: "test",
      port: 4100,
      jwtSecret: "test-secret",
      clientOrigin: "http://localhost:4000",
      databaseUrl: INVALID_TEST_DATABASE_URL,
      snapshotStorageRoot: "tmp/snapshots",
      compileStorageRoot: "tmp/compiles",
      binaryContentStorageRoot: "tmp/binary-content",
      compileTimeoutMs: 120000,
      compileDockerImage: "texlive/texlive:2024",
      shutdownDrainTimeoutMs: 10000,
    });
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() =>
      loadConfig({
        CLIENT_ORIGIN: "http://localhost:5173",
      }),
    ).toThrow("JWT_SECRET is required");
  });

  it("throws when CLIENT_ORIGIN is missing", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "test-secret",
        DATABASE_URL: INVALID_TEST_DATABASE_URL,
      }),
    ).toThrow("CLIENT_ORIGIN is required");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173",
      }),
    ).toThrow("DATABASE_URL is required");
  });

  it("treats blank env values as missing", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "   ",
        CLIENT_ORIGIN: "http://localhost:5173",
        DATABASE_URL: INVALID_TEST_DATABASE_URL,
      }),
    ).toThrow("JWT_SECRET is required");
  });

  it("treats blank DATABASE_URL as missing", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173",
        DATABASE_URL: "   ",
      }),
    ).toThrow("DATABASE_URL is required");
  });

  it("throws for an invalid SHUTDOWN_DRAIN_TIMEOUT_MS", () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173",
        DATABASE_URL: INVALID_TEST_DATABASE_URL,
        SHUTDOWN_DRAIN_TIMEOUT_MS: "not-a-number",
      }),
    ).toThrow("SHUTDOWN_DRAIN_TIMEOUT_MS must be a positive integer");
  });

  it("treats whitespace SHUTDOWN_DRAIN_TIMEOUT_MS as default", () => {
    const config = loadConfig({
      JWT_SECRET: "test-secret",
      CLIENT_ORIGIN: "http://localhost:5173",
      DATABASE_URL: INVALID_TEST_DATABASE_URL,
      SHUTDOWN_DRAIN_TIMEOUT_MS: "   ",
    });

    expect(config.shutdownDrainTimeoutMs).toBe(5000);
  });

  it("throws for an invalid port", () => {
    expect(() =>
      loadConfig({
        PORT: "not-a-number",
        JWT_SECRET: "test-secret",
        CLIENT_ORIGIN: "http://localhost:5173",
        DATABASE_URL: INVALID_TEST_DATABASE_URL,
      }),
    ).toThrow("PORT must be a positive integer");
  });
});
