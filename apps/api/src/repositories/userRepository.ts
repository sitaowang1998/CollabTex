import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DuplicateEmailError,
  type AuthUserRepository,
} from "../services/auth.js";

export function createUserRepository(
  databaseClient: DatabaseClient,
): AuthUserRepository {
  return {
    findByEmail: async (email) =>
      databaseClient.user.findUnique({
        where: { email },
      }),
    findById: async (id) =>
      databaseClient.user.findUnique({
        where: { id },
      }),
    create: async ({ email, name, passwordHash }) => {
      try {
        return await databaseClient.user.create({
          data: {
            email,
            name,
            passwordHash,
          },
        });
      } catch (error) {
        if (
          isPrismaKnownRequestLikeError(error) &&
          error.code === "P2002" &&
          isDuplicateEmailTarget(error.meta)
        ) {
          throw new DuplicateEmailError();
        }

        throw error;
      }
    },
  };
}

function isPrismaKnownRequestLikeError(
  error: unknown,
): error is Error & { code: string; meta?: unknown } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function isDuplicateEmailTarget(target: unknown): boolean {
  const emailFieldMatcher = (candidate: unknown) =>
    typeof candidate === "string" && candidate.toLowerCase().includes("email");

  if (Array.isArray(target)) {
    return target.some(emailFieldMatcher);
  }

  if (typeof target === "object" && target !== null) {
    const normalizedTarget = (target as { target?: unknown }).target;
    if (normalizedTarget !== undefined) {
      return isDuplicateEmailTarget(normalizedTarget);
    }

    const nestedFields = (
      target as {
        driverAdapterError?: {
          cause?: {
            constraint?: {
              fields?: unknown;
            };
          };
        };
      }
    ).driverAdapterError?.cause?.constraint?.fields;

    if (nestedFields !== undefined) {
      return isDuplicateEmailTarget(nestedFields);
    }

    return false;
  }

  return emailFieldMatcher(target);
}
