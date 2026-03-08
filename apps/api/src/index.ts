import dotenv from "dotenv";
import http from "http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/appConfig.js";
import { createHttpApp } from "./http/app.js";
import { createArgon2PasswordHasher } from "./infrastructure/auth/argon2PasswordHasher.js";
import { createDatabaseClient } from "./infrastructure/db/client.js";
import { createMembershipRepository } from "./repositories/membershipRepository.js";
import { createProjectRepository } from "./repositories/projectRepository.js";
import { createUserRepository } from "./repositories/userRepository.js";
import { createAuthService } from "./services/auth.js";
import { createMembershipService } from "./services/membership.js";
import { createProjectAccessService } from "./services/projectAccess.js";
import { createProjectService } from "./services/project.js";
import { createSocketServer } from "./ws/socketServer.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const DUMMY_PASSWORD = "__collab_tex_dummy_password__";

void main();

async function main() {
  const config = loadConfig();
  const databaseClient = createDatabaseClient(config.databaseUrl);
  const passwordHasher = createArgon2PasswordHasher();

  try {
    await databaseClient.$connect();

    const dummyPasswordHash = await passwordHasher.hash(DUMMY_PASSWORD);
    const userRepository = createUserRepository(databaseClient);
    const projectRepository = createProjectRepository(databaseClient);
    const projectAccessService = createProjectAccessService({
      projectRepository,
    });
    const authService = createAuthService({
      userRepository,
      passwordHasher,
      jwtSecret: config.jwtSecret,
      dummyPasswordHash,
    });
    const projectService = createProjectService({
      projectRepository,
      projectAccessService,
    });
    const membershipService = createMembershipService({
      membershipRepository: createMembershipRepository(databaseClient),
      userLookup: userRepository,
      projectAccessService,
    });
    const app = createHttpApp(config, {
      authService,
      membershipService,
      projectService,
    });
    const server = http.createServer(app);
    const io = createSocketServer(server, config);

    installShutdownHandlers({ server, io, databaseClient });
    await listen(server, config.port);

    console.log(`API+Socket.io listening on http://localhost:${config.port}`);
  } catch (error) {
    await databaseClient.$disconnect().catch(() => {});
    console.error("Failed to start API", error);
    process.exitCode = 1;
  }
}

function installShutdownHandlers({
  server,
  io,
  databaseClient,
}: {
  server: http.Server;
  io: ReturnType<typeof createSocketServer>;
  databaseClient: ReturnType<typeof createDatabaseClient>;
}) {
  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down`);

    try {
      await closeSocketServer(io);
      await closeHttpServer(server);
      await databaseClient.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error("Failed to shut down cleanly", error);
      process.exit(1);
    }
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function listen(server: http.Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeSocketServer(io: ReturnType<typeof createSocketServer>) {
  await new Promise<void>((resolve, reject) => {
    io.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeHttpServer(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (
        !error ||
        (isErrnoException(error) && error.code === "ERR_SERVER_NOT_RUNNING")
      ) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function isErrnoException(error: Error): error is NodeJS.ErrnoException {
  return "code" in error;
}
