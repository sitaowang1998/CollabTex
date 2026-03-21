import dotenv from "dotenv";
import http from "http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/appConfig.js";
import { createHttpApp } from "./http/app.js";
import { createArgon2PasswordHasher } from "./infrastructure/auth/argon2PasswordHasher.js";
import { createDatabaseClient } from "./infrastructure/db/client.js";
import { createDockerCompileAdapter } from "./infrastructure/compile/dockerCompileAdapter.js";
import { createLocalFilesystemCompileStore } from "./infrastructure/storage/localFilesystemCompileStore.js";
import { createLocalFilesystemSnapshotStore } from "./infrastructure/storage/localFilesystemSnapshotStore.js";
import { createDocumentRepository } from "./repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "./repositories/documentTextStateRepository.js";
import { createCommentRepository } from "./repositories/commentRepository.js";
import { createMembershipRepository } from "./repositories/membershipRepository.js";
import { createProjectStateRepository } from "./repositories/projectStateRepository.js";
import { createProjectRepository } from "./repositories/projectRepository.js";
import { createSnapshotRepository } from "./repositories/snapshotRepository.js";
import { createSnapshotRefreshJobRepository } from "./repositories/snapshotRefreshJobRepository.js";
import { createUserRepository } from "./repositories/userRepository.js";
import { createAuthService } from "./services/auth.js";
import { createCollaborationService } from "./services/collaboration.js";
import { createCompileDispatchService } from "./services/compileDispatch.js";
import { createCommentService } from "./services/commentService.js";
import { createCurrentTextStateService } from "./services/currentTextState.js";
import { createDocumentService } from "./services/document.js";
import { createMembershipService } from "./services/membership.js";
import { createActiveDocumentIdleReconciler } from "./services/activeDocumentIdleReconciler.js";
import { createActiveDocumentRegistry } from "./services/activeDocumentRegistry.js";
import { createActiveDocumentStateLoader } from "./services/activeDocumentStateLoader.js";
import { createProjectAccessService } from "./services/projectAccess.js";
import { createProjectService } from "./services/project.js";
import { createRealtimeDocumentService } from "./services/realtimeDocument.js";
import {
  createSnapshotService,
  type SnapshotResetPublisher,
} from "./services/snapshot.js";
import { createSnapshotManagementService } from "./services/snapshotManagement.js";
import {
  createSnapshotRefreshProcessor,
  createSnapshotRefreshTrigger,
} from "./services/snapshotRefresh.js";
import { createWorkspaceService } from "./services/workspace.js";
import {
  createCompileDonePublisher,
  createSocketDocumentResetPublisher,
  createSocketServer,
} from "./ws/socketServer.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const DUMMY_PASSWORD = "__collab_tex_dummy_password__";

void main();

async function main() {
  const config = loadConfig();
  const databaseClient = createDatabaseClient(config.databaseUrl);
  const passwordHasher = createArgon2PasswordHasher();
  const snapshotStore = createLocalFilesystemSnapshotStore(
    config.snapshotStorageRoot,
  );

  try {
    await databaseClient.$connect();

    const dummyPasswordHash = await passwordHasher.hash(DUMMY_PASSWORD);
    const userRepository = createUserRepository(databaseClient);
    const projectRepository = createProjectRepository(databaseClient);
    const documentRepository = createDocumentRepository(databaseClient);
    const documentTextStateRepository =
      createDocumentTextStateRepository(databaseClient);
    const projectStateRepository = createProjectStateRepository(databaseClient);
    const snapshotRepository = createSnapshotRepository(databaseClient);
    const snapshotRefreshJobRepository =
      createSnapshotRefreshJobRepository(databaseClient);
    const collaborationService = createCollaborationService();
    const projectAccessService = createProjectAccessService({
      projectRepository,
    });
    let resetPublisher: SnapshotResetPublisher = {
      emitDocumentReset: async () => {},
    };
    const snapshotService = createSnapshotService({
      snapshotRepository,
      snapshotStore,
      documentTextStateRepository,
      collaborationService,
      projectStateRepository,
      getResetPublisher: () => resetPublisher,
    });
    const currentTextStateService = createCurrentTextStateService({
      documentTextStateRepository,
      snapshotService,
      collaborationService,
    });
    const activeDocumentRegistry = createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: createActiveDocumentStateLoader({
        documentRepository,
        currentTextStateService,
      }),
      persistOnIdle: createActiveDocumentIdleReconciler({
        documentTextStateRepository,
        currentTextStateService,
      }),
    });
    const snapshotRefreshProcessor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository,
      projectLookup: projectRepository,
      snapshotService,
      documentRepository,
    });
    await snapshotRefreshJobRepository.recoverInterruptedJobs();
    const snapshotRefreshTrigger = createSnapshotRefreshTrigger({
      snapshotRefreshProcessor,
    });
    const authService = createAuthService({
      userRepository,
      passwordHasher,
      jwtSecret: config.jwtSecret,
      dummyPasswordHash,
    });
    const documentService = createDocumentService({
      documentRepository,
      projectAccessService,
      snapshotService,
      snapshotRefreshTrigger,
    });
    const projectService = createProjectService({
      projectRepository,
      documentLookup: documentRepository,
      projectAccessService,
    });
    const membershipService = createMembershipService({
      membershipRepository: createMembershipRepository(databaseClient),
      userLookup: userRepository,
      projectAccessService,
    });
    const commentService = createCommentService({
      commentRepository: createCommentRepository(databaseClient),
      projectAccessService,
    });
    const snapshotManagementService = createSnapshotManagementService({
      projectAccessService,
      snapshotService,
    });
    const compileArtifactStore = createLocalFilesystemCompileStore(
      config.compileStorageRoot,
    );
    const compileAdapter = createDockerCompileAdapter({
      dockerImage: config.compileDockerImage,
    });
    let compileDoneNotifier: (
      event: import("@collab-tex/shared").CompileDoneEvent,
    ) => void = () => {};
    const compileDispatchService = createCompileDispatchService({
      projectAccessService,
      projectService,
      fileAssemblyDeps: {
        documentRepository,
        documentTextStateRepository,
        snapshotRepository,
        snapshotStore,
      },
      compileAdapter,
      compileArtifactStore,
      compileTimeoutMs: config.compileTimeoutMs,
      notifyCompileDone: (event) => compileDoneNotifier(event),
    });
    const app = createHttpApp(config, {
      authService,
      commentService,
      compileDispatchService,
      documentService,
      membershipService,
      projectService,
      snapshotManagementService,
    });
    const server = http.createServer(app);
    const io = createSocketServer(server, config, {
      workspaceService: createWorkspaceService({
        projectAccessService,
        documentRepository,
        currentTextStateService,
      }),
      activeDocumentRegistry,
      projectAccessService,
      realtimeDocumentService: createRealtimeDocumentService({
        collaborationService,
        projectAccessService,
        documentRepository,
        currentTextStateService,
      }),
    });
    resetPublisher = createSocketDocumentResetPublisher(
      io,
      activeDocumentRegistry,
    );
    const compileDonePublisher = createCompileDonePublisher(io);
    compileDoneNotifier = compileDonePublisher.emitCompileDone;

    installShutdownHandlers({
      server,
      io,
      databaseClient,
      snapshotRefreshTrigger,
      activeDocumentRegistry,
      shutdownDrainTimeoutMs: config.shutdownDrainTimeoutMs,
    });
    snapshotRefreshTrigger.kick();
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
  snapshotRefreshTrigger,
  activeDocumentRegistry,
  shutdownDrainTimeoutMs,
}: {
  server: http.Server;
  io: ReturnType<typeof createSocketServer>;
  databaseClient: ReturnType<typeof createDatabaseClient>;
  snapshotRefreshTrigger: ReturnType<typeof createSnapshotRefreshTrigger>;
  activeDocumentRegistry: ReturnType<typeof createActiveDocumentRegistry>;
  shutdownDrainTimeoutMs: number;
}) {
  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down`);
    let hadError = false;

    try {
      snapshotRefreshTrigger.stop();
    } catch (error) {
      hadError = true;
      console.error("Shutdown: snapshot refresh stop failed", error);
    }

    try {
      await closeSocketServer(io);
    } catch (error) {
      hadError = true;
      console.error("Shutdown: socket server close failed", error);
    }

    try {
      const drainResult = await activeDocumentRegistry.drain(
        shutdownDrainTimeoutMs,
      );
      if (drainResult.timedOut || drainResult.failedCount > 0) {
        hadError = true;
      }
    } catch (error) {
      hadError = true;
      console.error("Shutdown: drain failed", error);
    }

    try {
      await closeHttpServer(server);
    } catch (error) {
      hadError = true;
      console.error("Shutdown: HTTP server close failed", error);
    }

    try {
      await databaseClient.$disconnect();
    } catch (error) {
      hadError = true;
      console.error("Shutdown: database disconnect failed", error);
    }

    process.exit(hadError ? 1 : 0);
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
