import { Prisma } from "@prisma/client";
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
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new DuplicateEmailError();
        }

        throw error;
      }
    },
  };
}
