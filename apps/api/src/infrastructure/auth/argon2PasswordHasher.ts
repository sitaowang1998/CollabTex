import argon2 from "argon2";
import type { PasswordHasher } from "../../services/auth.js";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

export function createArgon2PasswordHasher(): PasswordHasher {
  return {
    hash: async (password) => argon2.hash(password, ARGON2_OPTIONS),
    verify: async (password, passwordHash) => argon2.verify(passwordHash, password),
  };
}
