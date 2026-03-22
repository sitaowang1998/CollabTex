import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const apiRoot = resolve(repoRoot, "apps/api");
const webRoot = resolve(repoRoot, "apps/web");
const composeFilePath = resolve(apiRoot, "docker-compose.test.yml");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const localDatabaseHost = "127.0.0.1";
const localDatabaseName = "collabtex_api_test";
const localDatabaseUser = "postgres";
const localDatabasePassword = "postgres";
const serverReadyTimeoutMs = 60_000;
const serverPollIntervalMs = 500;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildDatabaseUrl(host: string, port: number): string {
  return `postgresql://${localDatabaseUser}:${localDatabasePassword}@${host}:${port}/${localDatabaseName}?schema=public`;
}

async function findFreeLocalPort(): Promise<number> {
  return new Promise<number>((res, rej) => {
    const server = net.createServer();
    server.once("error", rej);
    server.listen(0, localDatabaseHost, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => rej(new Error("Failed to determine free port")));
        return;
      }
      server.close((err) => (err ? rej(err) : res(addr.port)));
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(command, args, {
      cwd: opts.cwd ?? repoRoot,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
    });
    child.once("error", (err) =>
      rej(new Error(`Failed to start ${command}: ${formatError(err)}`)),
    );
    child.once("exit", (code, signal) => {
      if (code === 0) return res();
      if (signal)
        return rej(new Error(`${command} exited with signal ${signal}`));
      rej(new Error(`${command} exited with code ${code ?? "null"}`));
    });
  });
}

function spawnServer(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
): ChildProcess {
  const child = spawn(command, args, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdio: "inherit",
    detached: true,
  });
  child.once("error", (err) => {
    console.error(`Server process error (${command}): ${formatError(err)}`);
  });
  return child;
}

async function waitForServer(
  url: string,
  label: string,
  timeoutMs = serverReadyTimeoutMs,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      console.log(`${label} is ready`);
      return;
    } catch (err) {
      if (
        !(err instanceof TypeError) ||
        !/fetch|network|connect/i.test(err.message)
      ) {
        console.warn(`${label} health check error:`, err);
      }
      await new Promise((r) => setTimeout(r, serverPollIntervalMs));
    }
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      // Negative PID kills the entire process group (npx + its children)
      process.kill(-child.pid, signal);
    } catch {
      /* already dead */
    }
  }
}

function killProcess(child: ChildProcess): Promise<void> {
  return new Promise((res) => {
    if (child.exitCode !== null) {
      res();
      return;
    }
    const escalate = setTimeout(() => {
      killProcessGroup(child, "SIGKILL");
    }, 5_000);
    const giveUp = setTimeout(() => {
      console.error("Process did not exit after SIGKILL, abandoning cleanup");
      res();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(escalate);
      clearTimeout(giveUp);
      res();
    });
    killProcessGroup(child, "SIGTERM");
  });
}

async function teardownCompose(env: NodeJS.ProcessEnv) {
  await runCommand(
    "docker",
    ["compose", "-f", composeFilePath, "down", "-v", "--remove-orphans"],
    { env },
  );
}

async function main() {
  const pgPort = await findFreeLocalPort();
  const apiPort = await findFreeLocalPort();
  const vitePort = await findFreeLocalPort();
  if (new Set([pgPort, apiPort, vitePort]).size !== 3) {
    throw new Error(
      `Port collision detected (${pgPort}, ${apiPort}, ${vitePort}). Please re-run.`,
    );
  }

  const databaseUrl = buildDatabaseUrl(localDatabaseHost, pgPort);
  const composeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TEST_POSTGRES_PORT: String(pgPort),
    DATABASE_URL: databaseUrl,
  };

  let backendProcess: ChildProcess | undefined;
  let viteProcess: ChildProcess | undefined;

  // Ensure all resources are cleaned up if this script is interrupted
  function emergencyCleanup() {
    if (viteProcess) killProcessGroup(viteProcess, "SIGKILL");
    if (backendProcess) killProcessGroup(backendProcess, "SIGKILL");
    teardownCompose(composeEnv)
      .catch(() => {})
      .finally(() => process.exit(1));
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, emergencyCleanup);
  }

  try {
    // 1. Start PostgreSQL
    console.log(`Starting PostgreSQL on port ${pgPort}...`);
    await runCommand(
      "docker",
      [
        "compose",
        "-f",
        composeFilePath,
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "30",
      ],
      { env: composeEnv },
    );

    // 2. Run migrations
    console.log("Running Prisma migrations...");
    await runCommand(npmCommand, ["run", "prisma:generate"], {
      cwd: apiRoot,
      env: composeEnv,
    });
    await runCommand(npmCommand, ["run", "prisma:migrate:deploy"], {
      cwd: apiRoot,
      env: composeEnv,
    });

    // 3. Start backend
    const clientOrigin = `http://localhost:${vitePort}`;
    console.log(`Starting backend on port ${apiPort}...`);
    backendProcess = spawnServer(npxCommand, ["tsx", "src/index.ts"], {
      cwd: apiRoot,
      env: {
        ...composeEnv,
        PORT: String(apiPort),
        JWT_SECRET: "e2e-test-secret",
        CLIENT_ORIGIN: clientOrigin,
        NODE_ENV: "test",
      },
    });
    await waitForServer(`http://localhost:${apiPort}/api/auth/me`, "Backend");

    // 4. Start Vite dev server
    console.log(`Starting Vite dev server on port ${vitePort}...`);
    viteProcess = spawnServer(
      npxCommand,
      ["vite", "--port", String(vitePort)],
      {
        cwd: webRoot,
        env: {
          ...composeEnv,
          VITE_API_TARGET: `http://localhost:${apiPort}`,
        },
      },
    );
    await waitForServer(`http://localhost:${vitePort}`, "Vite dev server");

    // 5. Run Playwright tests
    console.log("Running Playwright tests...");
    await runCommand(
      npxCommand,
      ["playwright", "test", "--config", "e2e/playwright.config.ts"],
      {
        env: {
          ...process.env,
          E2E_BASE_URL: `http://localhost:${vitePort}`,
        },
      },
    );
  } finally {
    if (viteProcess) {
      console.log("Stopping Vite dev server...");
      await killProcess(viteProcess).catch((err) =>
        console.error(`Failed to stop Vite: ${formatError(err)}`),
      );
    }
    if (backendProcess) {
      console.log("Stopping backend...");
      await killProcess(backendProcess).catch((err) =>
        console.error(`Failed to stop backend: ${formatError(err)}`),
      );
    }
    console.log("Tearing down Docker containers...");
    await teardownCompose(composeEnv).catch((err) =>
      console.error(`Failed to tear down compose: ${formatError(err)}`),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(formatError(error));
    process.exit(1);
  });
