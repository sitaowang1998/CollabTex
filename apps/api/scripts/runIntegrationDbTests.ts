import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "..");
const composeFilePath = resolve(apiRoot, "docker-compose.test.yml");
const localDatabaseHost = "127.0.0.1";
const localDatabaseName = "collabtex_api_test";
const localDatabaseUser = "postgres";
const localDatabasePassword = "postgres";
const readinessTimeoutMs = 30_000;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

type IntegrationDatabaseConfig = {
  databaseUrl: string;
  host: string;
  port: number;
};

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

function composeArgs(...args: string[]) {
  return ["compose", "-f", composeFilePath, ...args];
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

async function resolveLocalIntegrationDatabaseConfig(): Promise<IntegrationDatabaseConfig> {
  const port = await findFreeLocalPort(localDatabaseHost);

  return {
    databaseUrl: buildDatabaseUrl(localDatabaseHost, port),
    host: localDatabaseHost,
    port
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? apiRoot,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: "inherit"
    });

    child.once("error", (error) => {
      rejectPromise(
        new Error(`Failed to start ${command}: ${formatError(error)}`)
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

async function teardownCompose() {
  await runCommand("docker", composeArgs("down", "-v", "--remove-orphans"));
}

async function main() {
  let shouldAttemptTeardown = false;
  let runError: unknown;
  let teardownError: unknown;
  const databaseConfig = await resolveLocalIntegrationDatabaseConfig();
  const waitTimeoutSeconds = Math.max(1, Math.ceil(readinessTimeoutMs / 1_000));

  const integrationEnv = {
    ...process.env,
    DATABASE_URL: databaseConfig.databaseUrl,
    TEST_POSTGRES_PORT: String(databaseConfig.port)
  };

  try {
    shouldAttemptTeardown = true;
    await runCommand("docker", [
      ...composeArgs("up", "-d", "--wait", "--wait-timeout"),
      String(waitTimeoutSeconds)
    ], {
      env: integrationEnv
    });

    await runCommand(npmCommand, ["run", "test:integration:db:prepare"], {
      cwd: apiRoot,
      env: integrationEnv
    });
    await runCommand(npmCommand, ["run", "test:integration:db:vitest"], {
      cwd: apiRoot,
      env: integrationEnv
    });
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    if (shouldAttemptTeardown) {
      try {
        await teardownCompose();
      } catch (error) {
        teardownError = error;
        if (runError) {
          console.error(
            `Failed to tear down integration test stack: ${formatError(error)}`
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
