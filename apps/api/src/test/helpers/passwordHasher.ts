import type { PasswordHasher } from "../../services/auth.js";

export function createTestPasswordHasher(): PasswordHasher {
  return {
    hash: async (password) => `hashed:${password}`,
    verify: async (password, passwordHash) =>
      passwordHash === `hashed:${password}`,
  };
}
