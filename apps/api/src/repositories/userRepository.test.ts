import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { DuplicateEmailError } from "../services/auth.js";
import { createUserRepository } from "./userRepository.js";

describe("user repository", () => {
  it("maps meta.target duplicate email errors to DuplicateEmailError", async () => {
    const repository = createUserRepository(
      createDatabaseClientThatRejects(
        createKnownRequestLikeError({
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

  it("maps driver adapter duplicate email errors to DuplicateEmailError", async () => {
    const repository = createUserRepository(
      createDatabaseClientThatRejects(
        createKnownRequestLikeError({
          driverAdapterError: {
            cause: {
              constraint: {
                fields: ["email"],
              },
            },
          },
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
    const error = createKnownRequestLikeError({
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

  it("rethrows non-P2002 errors", async () => {
    const error = createKnownRequestLikeError(
      {
        target: ["email"],
      },
      "P2003",
    );
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

function createKnownRequestLikeError(
  meta: Record<string, unknown>,
  code = "P2002",
) {
  return Object.assign(new Error("duplicate key"), {
    code,
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
