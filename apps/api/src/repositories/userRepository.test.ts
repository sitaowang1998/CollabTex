import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { DuplicateEmailError } from "../services/auth.js";
import { createUserRepository } from "./userRepository.js";

describe("user repository", () => {
  it("maps meta.target duplicate email errors to DuplicateEmailError", async () => {
    const repository = createUserRepository(
      createDatabaseClientThatRejects(
        createKnownRequestError({
          target: ["email"],
        }),
      ),
    );

    await expect(
      repository.create({
        email: "alice@example.com",
        name: "Alice",
        passwordHash: "hash",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("rethrows non-email unique constraint errors", async () => {
    const error = createKnownRequestError({
      target: ["storagePath"],
    });
    const repository = createUserRepository(
      createDatabaseClientThatRejects(error),
    );

    await expect(
      repository.create({
        email: "alice@example.com",
        name: "Alice",
        passwordHash: "hash",
      }),
    ).rejects.toBe(error);
  });
});

function createKnownRequestError(meta: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("duplicate key", {
    code: "P2002",
    clientVersion: "test",
    meta,
  });
}

function createDatabaseClientThatRejects(error: Error): DatabaseClient {
  return {
    user: {
      create: vi.fn().mockRejectedValue(error),
      findUnique: vi.fn(),
    },
  } as unknown as DatabaseClient;
}
