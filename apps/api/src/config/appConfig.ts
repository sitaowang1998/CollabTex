const DEFAULT_PORT = 3000;
const DEFAULT_JWT_SECRET = "dev_secret_change_me";
const DEFAULT_CLIENT_ORIGIN = "http://localhost:5173";

export type AppConfig = {
  port: number;
  jwtSecret: string;
  clientOrigin: string;
  databaseUrl?: string;
};

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    jwtSecret: env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
    clientOrigin: env.CLIENT_ORIGIN ?? DEFAULT_CLIENT_ORIGIN,
    databaseUrl: env.DATABASE_URL
  };
}
