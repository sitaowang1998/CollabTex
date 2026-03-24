const DEFAULT_PORT = 3000;
const DEFAULT_NODE_ENV = "development";
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

export type StorageConfigLocal = {
  storageBackend: "local";
  snapshotStorageRoot: string;
  compileStorageRoot: string;
  binaryContentStorageRoot: string;
};

export type StorageConfigS3 = {
  storageBackend: "s3";
  s3Region: string;
  s3Endpoint: string | null;
  s3BinaryContentBucket: string;
  s3SnapshotBucket: string;
  s3CompileBucket: string;
};

export type StorageConfig = StorageConfigLocal | StorageConfigS3;

export type AppConfig = {
  nodeEnv: string;
  port: number;
  jwtSecret: string;
  clientOrigin: string;
  databaseUrl: string;
  storage: StorageConfig;
  compileTimeoutMs: number;
  compileDockerImage: string;
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

const DEFAULT_BINARY_CONTENT_STORAGE_ROOT = "var/binary-content";
const DEFAULT_COMPILE_STORAGE_ROOT = "var/compiles";
const DEFAULT_COMPILE_TIMEOUT_MS = 60000;
const DEFAULT_COMPILE_DOCKER_IMAGE = "texlive/texlive:latest-small";

function parseBinaryContentStorageRoot(rawValue: string | undefined): string {
  const value = rawValue?.trim();

  return value ? value : DEFAULT_BINARY_CONTENT_STORAGE_ROOT;
}

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

function parseCompileDockerImage(rawValue: string | undefined): string {
  const value = rawValue?.trim();

  return value ? value : DEFAULT_COMPILE_DOCKER_IMAGE;
}

function parseStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const backend = env.STORAGE_BACKEND?.trim() || "local";

  if (backend === "s3") {
    return {
      storageBackend: "s3",
      s3Region: parseRequiredEnv("S3_REGION", env.S3_REGION),
      s3Endpoint: env.S3_ENDPOINT?.trim() || null,
      s3BinaryContentBucket: parseRequiredEnv(
        "S3_BINARY_CONTENT_BUCKET",
        env.S3_BINARY_CONTENT_BUCKET,
      ),
      s3SnapshotBucket: parseRequiredEnv(
        "S3_SNAPSHOT_BUCKET",
        env.S3_SNAPSHOT_BUCKET,
      ),
      s3CompileBucket: parseRequiredEnv(
        "S3_COMPILE_BUCKET",
        env.S3_COMPILE_BUCKET,
      ),
    };
  }

  if (backend !== "local") {
    throw new Error(
      `STORAGE_BACKEND must be "local" or "s3", got "${backend}"`,
    );
  }

  return {
    storageBackend: "local",
    snapshotStorageRoot: parseSnapshotStorageRoot(env.SNAPSHOT_STORAGE_ROOT),
    compileStorageRoot: parseCompileStorageRoot(env.COMPILE_STORAGE_ROOT),
    binaryContentStorageRoot: parseBinaryContentStorageRoot(
      env.BINARY_CONTENT_STORAGE_ROOT,
    ),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  return {
    nodeEnv,
    port: parsePort(env.PORT),
    jwtSecret: parseRequiredEnv("JWT_SECRET", env.JWT_SECRET),
    clientOrigin: parseRequiredEnv("CLIENT_ORIGIN", env.CLIENT_ORIGIN),
    databaseUrl: parseRequiredEnv("DATABASE_URL", env.DATABASE_URL),
    storage: parseStorageConfig(env),
    compileTimeoutMs: parseCompileTimeoutMs(env.COMPILE_TIMEOUT_MS),
    compileDockerImage: parseCompileDockerImage(env.COMPILE_DOCKER_IMAGE),
    shutdownDrainTimeoutMs: parseShutdownDrainTimeoutMs(
      env.SHUTDOWN_DRAIN_TIMEOUT_MS,
    ),
  };
}
