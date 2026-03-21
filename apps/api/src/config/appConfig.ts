const DEFAULT_PORT = 3000;
const DEFAULT_NODE_ENV = "development";
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

export type AppConfig = {
  nodeEnv: string;
  port: number;
  jwtSecret: string;
  clientOrigin: string;
  databaseUrl: string;
  snapshotStorageRoot: string;
  compileStorageRoot: string;
  compileTimeoutMs: number;
  shutdownDrainTimeoutMs: number;
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

function parseNodeEnv(rawNodeEnv: string | undefined): string {
  const nodeEnv = rawNodeEnv?.trim();

  return nodeEnv ? nodeEnv : DEFAULT_NODE_ENV;
}

function parseRequiredEnv(name: string, rawValue: string | undefined): string {
  const value = rawValue?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parseShutdownDrainTimeoutMs(rawValue: string | undefined): number {
  const trimmed = rawValue?.trim();
  if (trimmed === undefined || trimmed === "") {
    return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
  }

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("SHUTDOWN_DRAIN_TIMEOUT_MS must be a positive integer");
  }

  return value;
}

function parseSnapshotStorageRoot(
  rawSnapshotStorageRoot: string | undefined,
): string {
  const value = rawSnapshotStorageRoot?.trim();

  return value ? value : "var/snapshots";
}

const DEFAULT_COMPILE_STORAGE_ROOT = "var/compiles";
const DEFAULT_COMPILE_TIMEOUT_MS = 60000;

function parseCompileStorageRoot(rawValue: string | undefined): string {
  const value = rawValue?.trim();

  return value ? value : DEFAULT_COMPILE_STORAGE_ROOT;
}

function parseCompileTimeoutMs(rawValue: string | undefined): number {
  const trimmed = rawValue?.trim();
  if (trimmed === undefined || trimmed === "") {
    return DEFAULT_COMPILE_TIMEOUT_MS;
  }

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("COMPILE_TIMEOUT_MS must be a positive integer");
  }

  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  return {
    nodeEnv,
    port: parsePort(env.PORT),
    jwtSecret: parseRequiredEnv("JWT_SECRET", env.JWT_SECRET),
    clientOrigin: parseRequiredEnv("CLIENT_ORIGIN", env.CLIENT_ORIGIN),
    databaseUrl: parseRequiredEnv("DATABASE_URL", env.DATABASE_URL),
    snapshotStorageRoot: parseSnapshotStorageRoot(env.SNAPSHOT_STORAGE_ROOT),
    compileStorageRoot: parseCompileStorageRoot(env.COMPILE_STORAGE_ROOT),
    compileTimeoutMs: parseCompileTimeoutMs(env.COMPILE_TIMEOUT_MS),
    shutdownDrainTimeoutMs: parseShutdownDrainTimeoutMs(
      env.SHUTDOWN_DRAIN_TIMEOUT_MS,
    ),
  };
}
