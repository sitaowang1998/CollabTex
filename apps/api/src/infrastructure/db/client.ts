import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });

  return new PrismaClient({
    adapter
  });
}
