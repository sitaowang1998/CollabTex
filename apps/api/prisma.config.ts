import { config as loadDotEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const rootEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));
const INVALID_DATABASE_URL =
  "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public";

loadDotEnv({ path: rootEnvPath });
loadDotEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    // Use an obviously invalid default so generate/validate can run without a
    // real database, while migrate commands fail fast instead of targeting a
    // developer's local Postgres by accident.
    url: process.env.DATABASE_URL?.trim() || INVALID_DATABASE_URL,
  },
});
