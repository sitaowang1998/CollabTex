import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "..");
const composeFilePath = resolve(apiRoot, "docker-compose.test.yml");
const defaultDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:54329/collabtex_api_test?schema=public";
const readinessTimeoutMs = 30_000;
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

function assertSupportedComposeHost(host: string) {
  if (host === "127.0.0.1" || host === "localhost") {
    return;
  }

  throw new Error(
    "test:integration only supports Compose-managed local databases on localhost or 127.0.0.1"
  );
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
  const databaseUrl = getIntegrationDatabaseUrl();
  const { host, port } = getDatabaseAddress(databaseUrl);
  const waitTimeoutSeconds = Math.max(1, Math.ceil(readinessTimeoutMs / 1_000));

  assertSupportedComposeHost(host);

  const integrationEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_POSTGRES_PORT: String(port)
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
