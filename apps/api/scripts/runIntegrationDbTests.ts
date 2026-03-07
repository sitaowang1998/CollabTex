import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "..");
const composeFilePath = resolve(apiRoot, "docker-compose.test.yml");
const databaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:54329/collabtex_api_test?schema=public";
const postgresHost = "127.0.0.1";
const postgresPort = 54329;
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

  while (Date.now() < deadline) {
    try {
      await waitForPort(postgresHost, postgresPort);
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
  let composeStarted = false;
  let runError: unknown;
  let teardownError: unknown;
  const integrationEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl
  };

  try {
    await runCommand("docker", composeArgs("up", "-d"));
    composeStarted = true;

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
    if (composeStarted) {
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
