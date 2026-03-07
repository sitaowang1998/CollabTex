import type { PasswordHasher } from "../../services/auth.js";

export const TEST_DUMMY_PASSWORD = "__dummy_password__";
export const TEST_DUMMY_PASSWORD_HASH = `hashed:${TEST_DUMMY_PASSWORD}`;

export function createTestPasswordHasher(): PasswordHasher {
  return {
    hash: async (password) => `hashed:${password}`,
    verify: async (password, passwordHash) =>
      passwordHash === `hashed:${password}`,
  };
}
