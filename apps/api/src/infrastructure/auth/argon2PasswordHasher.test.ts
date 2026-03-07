import { describe, expect, it } from "vitest";
import { createArgon2PasswordHasher } from "./argon2PasswordHasher.js";

describe("argon2 password hasher", () => {
  const passwordHasher = createArgon2PasswordHasher();

  it("hashes and verifies a password", async () => {
    const hash = await passwordHasher.hash("correct horse battery staple");

    await expect(
      passwordHasher.verify("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await passwordHasher.hash("correct horse battery staple");

    await expect(passwordHasher.verify("wrong password", hash)).resolves.toBe(
      false,
    );
  });

  it("fails on malformed stored hashes", async () => {
    await expect(passwordHasher.verify("secret", "not-a-hash")).rejects.toThrow();
  });
});
