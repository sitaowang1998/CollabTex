import { PrismaClient } from "@prisma/client";

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl
      }
    }
  });
}
