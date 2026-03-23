import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createArgon2PasswordHasher } from "../infrastructure/auth/argon2PasswordHasher.js";
import { createUserRepository } from "../repositories/userRepository.js";
import {
  createAuthService,
  DuplicateEmailError,
  InvalidCredentialsError,
  verifyToken,
} from "../services/auth.js";
import type { AuthService } from "../services/auth.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

const JWT_SECRET = "test-secret-for-integration";

let db: DatabaseClient | undefined;
let authService: AuthService;
let dummyPasswordHash: string;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("auth integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();

    const passwordHasher = createArgon2PasswordHasher();
    dummyPasswordHash = await passwordHasher.hash("dummy-password-for-timing");
    const userRepository = createUserRepository(getDb());

    authService = createAuthService({
      userRepository,
      passwordHasher,
      jwtSecret: JWT_SECRET,
      dummyPasswordHash,
    });
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("registers a user then logs in with correct password", async () => {
    const suffix = randomUUID();
    const email = `auth-login-${suffix}@example.com`;

    const registerResult = await authService.register({
      email,
      name: "Auth User",
      password: "correct-password",
    });

    expect(registerResult.user.email).toBe(email);
    const registerPayload = verifyToken(registerResult.token, JWT_SECRET);
    expect(registerPayload.sub).toBe(registerResult.user.id);

    const loginResult = await authService.login({
      email,
      password: "correct-password",
    });

    expect(loginResult.user.email).toBe(email);
    expect(loginResult.user.id).toBe(registerResult.user.id);

    const payload = verifyToken(loginResult.token, JWT_SECRET);
    expect(payload.sub).toBe(registerResult.user.id);
  });

  it("rejects login with wrong password", async () => {
    const suffix = randomUUID();
    const email = `auth-wrong-${suffix}@example.com`;

    await authService.register({
      email,
      name: "Auth User",
      password: "correct-password",
    });

    await expect(
      authService.login({ email, password: "wrong-password" }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("rejects login with non-existent email", async () => {
    await expect(
      authService.login({
        email: `nonexistent-${randomUUID()}@example.com`,
        password: "any-password",
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("refreshes token for registered user", async () => {
    const suffix = randomUUID();
    const email = `auth-refresh-${suffix}@example.com`;

    const registerResult = await authService.register({
      email,
      name: "Refresh User",
      password: "password",
    });

    const refreshResult = await authService.refreshToken(
      registerResult.user.id,
    );

    expect(refreshResult.user.id).toBe(registerResult.user.id);
    expect(refreshResult.user.email).toBe(email);
    const refreshPayload = verifyToken(refreshResult.token, JWT_SECRET);
    expect(refreshPayload.sub).toBe(registerResult.user.id);
  });

  it("returns authenticated user data", async () => {
    const suffix = randomUUID();
    const email = `auth-me-${suffix}@example.com`;

    const registerResult = await authService.register({
      email,
      name: "Me User",
      password: "password",
    });

    const user = await authService.getAuthenticatedUser(
      registerResult.user.id,
    );

    expect(user).toEqual({
      id: registerResult.user.id,
      email,
      name: "Me User",
    });
  });

  it("rejects duplicate email registration", async () => {
    const suffix = randomUUID();
    const email = `auth-dup-${suffix}@example.com`;

    await authService.register({
      email,
      name: "First User",
      password: "password",
    });

    await expect(
      authService.register({
        email,
        name: "Second User",
        password: "password",
      }),
    ).rejects.toThrow(DuplicateEmailError);
  });
});
