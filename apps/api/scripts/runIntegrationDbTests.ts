import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "..");
const composeFilePath = resolve(apiRoot, "docker-compose.test.yml");
const defaultDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:54329/collabtex_api_test?schema=public";
const readinessTimeoutMs = 30_000;
const readinessRetryDelayMs = 1_000;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

function getIntegrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.TEST_DATABASE_URL?.trim() || defaultDatabaseUrl;
}

function getDatabaseAddress(databaseUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch (error) {
    throw new Error(
      `TEST_DATABASE_URL must be a valid database URL: ${formatError(error)}`
    );
  }

  const host = parsedUrl.hostname.trim();
  if (!host) {
    throw new Error("Integration database URL must include a hostname");
  }

  const port = parsedUrl.port ? Number(parsedUrl.port) : 5432;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Integration database URL must include a valid port");
  }

  return { host, port };
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

async function waitForPostgres(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  const { host, port } = getDatabaseAddress(url);

  while (Date.now() < deadline) {
    try {
      await waitForPort(host, port);
      return;
    } catch (error) {
      lastError = error;
      await delay(readinessRetryDelayMs);
    }
  }

  throw new Error(
    `Postgres at ${url} did not become ready within ${timeoutMs}ms: ${formatError(lastError)}`
  );
}

async function waitForPort(host: string, port: number) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.end();
      resolvePromise();
    });

    socket.once("error", (error) => {
      socket.destroy();
      rejectPromise(error);
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
  const databaseUrl = getIntegrationDatabaseUrl();
  const integrationEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl
  };

  try {
    shouldAttemptTeardown = true;
    await runCommand("docker", composeArgs("up", "-d"));

    await waitForPostgres(databaseUrl, readinessTimeoutMs);
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
