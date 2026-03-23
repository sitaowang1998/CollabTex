import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const apiRoot = resolve(repoRoot, "apps/api");
const webRoot = resolve(repoRoot, "apps/web");
const composeFilePath = resolve(repoRoot, "docker-compose.dev.yml");
const envPath = resolve(repoRoot, ".env");
const envExamplePath = resolve(repoRoot, ".env.example");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const apiPort = 13000;
const vitePort = 15173;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
): { child: ChildProcess; failed: Promise<never> } {
  const child = spawn(command, args, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdio: "inherit",
    detached: true,
  });
  const failed = new Promise<never>((_, reject) => {
    child.once("error", (err) => {
      reject(new Error(`Failed to spawn ${command}: ${formatError(err)}`));
    });
    child.once("exit", (code, sig) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} exited unexpectedly (code=${code}, signal=${sig})`,
          ),
        );
      }
    });
  });
  return { child, failed };
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ESRCH") {
        console.warn(`Failed to kill process group ${child.pid}:`, err);
      }
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

async function waitForServer(
  url: string,
  label: string,
  timeoutMs = 60_000,
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
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

async function teardownCompose() {
  await runCommand("docker", ["compose", "-f", composeFilePath, "down"]);
}

async function main() {
  // 1. Ensure .env exists
  if (!existsSync(envPath)) {
    console.log("Copying .env.example → .env");
    copyFileSync(envExamplePath, envPath);
  }

  // 2. Start PostgreSQL
  console.log("Starting PostgreSQL...");
  await runCommand("docker", [
    "compose",
    "-f",
    composeFilePath,
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "30",
  ]);

  // 3. Prisma generate + migrate
  console.log("Running Prisma generate...");
  await runCommand(npmCommand, ["run", "prisma:generate"], {
    cwd: apiRoot,
  });
  console.log("Running Prisma migrations...");
  await runCommand(npmCommand, ["run", "prisma:migrate:dev"], {
    cwd: apiRoot,
  });

  // 4. Start servers
  console.log(`Starting API on port ${apiPort}...`);
  const api = spawnServer(npxCommand, ["tsx", "watch", "src/index.ts"], {
    cwd: apiRoot,
  });
  const apiProcess = api.child;

  console.log(`Starting Vite on port ${vitePort}...`);
  const vite = spawnServer(
    npxCommand,
    ["vite", "--port", String(vitePort), "--host"],
    {
      cwd: webRoot,
      env: { VITE_API_TARGET: `http://localhost:${apiPort}` },
    },
  );
  const viteProcess = vite.child;

  function cleanup() {
    console.log("\nShutting down...");
    Promise.all([
      killProcess(viteProcess).catch((err) =>
        console.error(`Failed to stop Vite: ${formatError(err)}`),
      ),
      killProcess(apiProcess).catch((err) =>
        console.error(`Failed to stop API: ${formatError(err)}`),
      ),
    ])
      .then(() => teardownCompose())
      .catch((err) =>
        console.error(
          `Teardown failed (manual cleanup may be needed): ${formatError(err)}`,
        ),
      )
      .finally(() => process.exit(0));
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, cleanup);
  }

  await Promise.race([
    waitForServer(`http://localhost:${apiPort}/api/auth/me`, "API"),
    api.failed,
  ]);
  await Promise.race([
    waitForServer(`http://localhost:${vitePort}`, "Vite"),
    vite.failed,
  ]);

  console.log(`\nDev servers ready:`);
  console.log(`  Frontend: http://localhost:${vitePort}`);
  console.log(`  API:      http://localhost:${apiPort}`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Keep alive until signal
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
