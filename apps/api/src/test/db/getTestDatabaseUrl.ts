export function getRequiredTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for DB integration tests");
  }

  return databaseUrl;
}
