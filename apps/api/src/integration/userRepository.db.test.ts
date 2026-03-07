import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserRepository } from "../repositories/userRepository.js";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { DuplicateEmailError } from "../services/auth.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("user repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("creates and reads users by email and id", async () => {
    const suffix = randomUUID();
    const repository = createUserRepository(getDb());

    const created = await repository.create({
      email: `user-${suffix}@example.com`,
      name: "Test User",
      passwordHash: "hash",
    });

    await expect(repository.findByEmail(created.email)).resolves.toMatchObject({
      id: created.id,
      email: created.email,
      name: "Test User",
    });
    await expect(repository.findById(created.id)).resolves.toMatchObject({
      id: created.id,
      email: created.email,
      name: "Test User",
    });
  });

  it("maps duplicate emails to a domain error", async () => {
    const suffix = randomUUID();
    const repository = createUserRepository(getDb());
    const email = `duplicate-${suffix}@example.com`;

    await repository.create({
      email,
      name: "User One",
      passwordHash: "hash-1",
    });

    await expect(
      repository.create({
        email,
        name: "User Two",
        passwordHash: "hash-2",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });
});
