import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "..");
const composeFilePath = resolve(apiRoot, "docker-compose.test.yml");
const localHost = "127.0.0.1";
const localDatabaseName = "collabtex_api_test";
const localDatabaseUser = "postgres";
const localDatabasePassword = "postgres";
const readinessTimeoutMs = 60_000;
const maxComposeStartupAttempts = 3;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const testS3Buckets = [
  "collabtex-test-binary-content",
  "collabtex-test-snapshots",
  "collabtex-test-compiles",
];

type IntegrationConfig = {
  databaseUrl: string;
  postgresPort: number;
  localstackPort: number;
  s3Endpoint: string;
};

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

function composeArgs(...args: string[]) {
  return ["compose", "-f", composeFilePath, ...args];
}

function createIntegrationEnv(config: IntegrationConfig) {
  return {
    ...process.env,
    DATABASE_URL: config.databaseUrl,
    TEST_POSTGRES_PORT: String(config.postgresPort),
    TEST_LOCALSTACK_PORT: String(config.localstackPort),
    TEST_S3_ENDPOINT: config.s3Endpoint,
    TEST_S3_REGION: "us-east-1",
    TEST_S3_BINARY_CONTENT_BUCKET: testS3Buckets[0],
    TEST_S3_SNAPSHOT_BUCKET: testS3Buckets[1],
    TEST_S3_COMPILE_BUCKET: testS3Buckets[2],
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function buildDatabaseUrl(host: string, port: number): string {
  return `postgresql://${localDatabaseUser}:${localDatabasePassword}@${host}:${port}/${localDatabaseName}?schema=public`;
}

async function findFreeLocalPort(host: string): Promise<number> {
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const server = net.createServer();

    server.once("error", (error) => {
      rejectPromise(error);
    });

    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          rejectPromise(new Error("Failed to determine a free local port"));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(address.port);
      });
    });
  });
}

async function resolveIntegrationConfig(): Promise<IntegrationConfig> {
  const postgresPort = await findFreeLocalPort(localHost);
  const localstackPort = await findFreeLocalPort(localHost);

  return {
    databaseUrl: buildDatabaseUrl(localHost, postgresPort),
    postgresPort,
    localstackPort,
    s3Endpoint: `http://${localHost}:${localstackPort}`,
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? apiRoot,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    child.once("error", (error) => {
      rejectPromise(
        new Error(`Failed to start ${command}: ${formatError(error)}`),
      );
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      if (signal) {
        rejectPromise(new Error(`${command} exited with signal ${signal}`));
        return;
      }

      rejectPromise(new Error(`${command} exited with code ${code ?? "null"}`));
    });
  });
}

function isRetryableComposeStartupError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();

  return (
    message.includes("address already in use") ||
    message.includes("port is already allocated") ||
    message.includes("ports are not available") ||
    message.includes("bind: address already in use")
  );
}

async function teardownCompose(env?: NodeJS.ProcessEnv) {
  await runCommand("docker", composeArgs("down", "-v", "--remove-orphans"), {
    env,
  });
}

async function createS3Buckets(s3Endpoint: string) {
  const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "us-east-1",
    endpoint: s3Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  });

  for (const bucket of testS3Buckets) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "BucketAlreadyOwnedByYou" ||
          error.name === "BucketAlreadyExists")
      ) {
        continue;
      }
      throw error;
    }
  }

  client.destroy();
}

async function startComposeWithRetries(waitTimeoutSeconds: number) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxComposeStartupAttempts; attempt += 1) {
    const config = await resolveIntegrationConfig();
    const integrationEnv = createIntegrationEnv(config);

    try {
      await runCommand(
        "docker",
        [
          ...composeArgs("up", "-d", "--wait", "--wait-timeout"),
          String(waitTimeoutSeconds),
        ],
        {
          env: integrationEnv,
        },
      );

      await createS3Buckets(config.s3Endpoint);

      return { config, integrationEnv };
    } catch (error) {
      lastError = error;

      try {
        await teardownCompose(integrationEnv);
      } catch (teardownError) {
        console.error(
          `Failed to tear down integration test stack after startup failure: ${formatError(teardownError)}`,
        );
      }

      if (
        !isRetryableComposeStartupError(error) ||
        attempt === maxComposeStartupAttempts
      ) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function main() {
  let runError: unknown;
  let teardownError: unknown;
  const waitTimeoutSeconds = Math.max(1, Math.ceil(readinessTimeoutMs / 1_000));
  let integrationEnv: NodeJS.ProcessEnv | undefined;

  try {
    ({ integrationEnv } = await startComposeWithRetries(waitTimeoutSeconds));

    await runCommand(npmCommand, ["run", "test:integration:db:prepare"], {
      cwd: apiRoot,
      env: integrationEnv,
    });
    await runCommand(npmCommand, ["run", "test:integration:db:vitest"], {
      cwd: apiRoot,
      env: integrationEnv,
    });
    await runCommand(npmCommand, ["run", "test:integration:s3:vitest"], {
      cwd: apiRoot,
      env: integrationEnv,
    });
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    if (integrationEnv) {
      try {
        await teardownCompose(integrationEnv);
      } catch (error) {
        teardownError = error;
        if (runError) {
          console.error(
            `Failed to tear down integration test stack: ${formatError(error)}`,
          );
        }
      }
    }
  }

  if (!runError && teardownError) {
    throw teardownError;
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
