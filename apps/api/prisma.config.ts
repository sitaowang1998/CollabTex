import { config as loadDotEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const rootEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));
const defaultDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/collabtex?schema=public";

loadDotEnv({ path: rootEnvPath });
loadDotEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  engine: "classic",
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl
  }
});
