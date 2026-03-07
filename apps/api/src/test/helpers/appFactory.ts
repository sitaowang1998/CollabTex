import { createHttpApp } from "../../http/app.js";
import type { AppConfig } from "../../config/appConfig.js";
import { createArgon2PasswordHasher } from "../../infrastructure/auth/argon2PasswordHasher.js";
import { createAuthService, DuplicateEmailError, type AuthUserRepository } from "../../services/auth.js";

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
  const authService = createAuthService({
    userRepository: createInMemoryUserRepository(),
    passwordHasher: createArgon2PasswordHasher(),
    jwtSecret: testConfig.jwtSecret,
  });

  return createHttpApp(testConfig, { authService });
}

function createInMemoryUserRepository(): AuthUserRepository {
  const usersById = new Map<
    string,
    { id: string; email: string; name: string; passwordHash: string }
  >();
  let nextId = 1;

  return {
    findByEmail: async (email) => {
      for (const user of usersById.values()) {
        if (user.email === email) {
          return user;
        }
      }

      return null;
    },
    findById: async (id) => usersById.get(id) ?? null,
    create: async ({ email, name, passwordHash }) => {
      for (const user of usersById.values()) {
        if (user.email === email) {
          throw new DuplicateEmailError();
        }
      }

      const user = {
        id: `user-${nextId}`,
        email,
        name,
        passwordHash,
      };
      nextId += 1;
      usersById.set(user.id, user);

      return user;
    },
  };
}
