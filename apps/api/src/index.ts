import dotenv from "dotenv";
import http from "http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/appConfig.js";
import { createHttpApp } from "./http/app.js";
import { createArgon2PasswordHasher } from "./infrastructure/auth/argon2PasswordHasher.js";
import { createDatabaseClient } from "./infrastructure/db/client.js";
import { createDockerCompileAdapter } from "./infrastructure/compile/dockerCompileAdapter.js";
import { createStores } from "./infrastructure/storage/createStores.js";
import { createCompileBuildRepository } from "./repositories/compileBuildRepository.js";
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
import { createBinaryContentService } from "./services/binaryContent.js";
import { createCollaborationService } from "./services/collaboration.js";
import { createCompileDispatchService } from "./services/compileDispatch.js";
import { createCompileRetrievalService } from "./services/compileRetrieval.js";
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
import { createSnapshotService } from "./services/snapshot.js";
import { createSnapshotManagementService } from "./services/snapshotManagement.js";
import {
  createSnapshotRefreshProcessor,
  createSnapshotRefreshTrigger,
} from "./services/snapshotRefresh.js";
import { createQueueProjectSnapshot } from "./services/snapshotQueue.js";
import { createSnapshotPeriodicTrigger } from "./services/snapshotPeriodicTrigger.js";
import { createWorkspaceService } from "./services/workspace.js";
import {
  createCommentPublisher,
  createCompileDonePublisher,
  createFileTreePublisher,
  createSnapshotPublisher,
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
  const stores = createStores(config.storage);
  const { snapshotStore, binaryContentStore, compileArtifactStore } = stores;

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
    const activeDocumentRegistryRef: {
      current: { invalidate: (input: { projectId: string; documentId: string }) => { invalidatedGeneration: number } } | null;
    } = { current: null };
    const commentRepository = createCommentRepository(databaseClient);
    const snapshotService = createSnapshotService({
      snapshotRepository,
      snapshotStore,
      documentTextStateRepository,
      collaborationService,
      projectStateRepository,
      binaryContentStore,
      documentLookup: documentRepository,
      commentThreadLookup: commentRepository,
      invalidateActiveDocuments: (documents) => {
        for (const doc of documents) {
          activeDocumentRegistryRef.current?.invalidate(doc);
        }
      },
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
    activeDocumentRegistryRef.current = activeDocumentRegistry;
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
    const queueProjectSnapshot = createQueueProjectSnapshot({
      databaseClient,
      snapshotRepository,
      snapshotRefreshTrigger,
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
      binaryContentStore,
    });
    const projectService = createProjectService({
      projectRepository,
      documentLookup: documentRepository,
      documentListing: documentRepository,
      binaryContentStore,
      projectAccessService,
    });
    const membershipService = createMembershipService({
      membershipRepository: createMembershipRepository(databaseClient),
      userLookup: userRepository,
      projectAccessService,
    });
    const commentService = createCommentService({
      commentRepository,
      projectAccessService,
    });
    const snapshotManagementService = createSnapshotManagementService({
      projectAccessService,
      snapshotService,
    });
    const compileBuildRepository = createCompileBuildRepository(databaseClient);
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
        binaryContentStore,
      },
      compileAdapter,
      compileArtifactStore,
      compileBuildRepository,
      compileTimeoutMs: config.compileTimeoutMs,
      notifyCompileDone: (event) => compileDoneNotifier(event),
      queueProjectSnapshot,
    });
    const compileRetrievalService = createCompileRetrievalService({
      projectAccessService,
      compileBuildRepository,
      compileArtifactStore,
    });
    const binaryContentService = createBinaryContentService({
      projectAccessService,
      documentRepository,
      binaryContentStore,
      queueProjectSnapshot,
    });
    const commentPublisherRef: {
      current: ReturnType<typeof createCommentPublisher> | undefined;
    } = { current: undefined };
    const fileTreePublisherRef: {
      current: ReturnType<typeof createFileTreePublisher> | undefined;
    } = { current: undefined };
    const snapshotPublisherRef: {
      current: ReturnType<typeof createSnapshotPublisher> | undefined;
    } = { current: undefined };
    const app = createHttpApp(config, {
      authService,
      binaryContentService,
      commentService,
      compileDispatchService,
      compileRetrievalService,
      documentService,
      membershipService,
      projectService,
      snapshotManagementService,
      commentPublisherRef,
      fileTreePublisherRef,
      snapshotPublisherRef,
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
      touchProjectUpdatedAt: (projectId) =>
        projectRepository.touchUpdatedAt(projectId),
      queueProjectSnapshot,
    });
    const compileDonePublisher = createCompileDonePublisher(io);
    compileDoneNotifier = compileDonePublisher.emitCompileDone;
    commentPublisherRef.current = createCommentPublisher(io);
    fileTreePublisherRef.current = createFileTreePublisher(io);
    snapshotPublisherRef.current = createSnapshotPublisher(io);

    const snapshotPeriodicTrigger = createSnapshotPeriodicTrigger({
      activeDocumentRegistry,
      queueProjectSnapshot,
    });
    installShutdownHandlers({
      server,
      io,
      databaseClient,
      snapshotRefreshTrigger,
      snapshotPeriodicTrigger,
      activeDocumentRegistry,
      destroyStores: stores.destroy,
      shutdownDrainTimeoutMs: config.shutdownDrainTimeoutMs,
    });
    snapshotRefreshTrigger.kick();
    await listen(server, config.port);

    console.log(`API+Socket.io listening on http://localhost:${config.port}`);
  } catch (error) {
    stores.destroy?.();
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
  snapshotPeriodicTrigger,
  activeDocumentRegistry,
  destroyStores,
  shutdownDrainTimeoutMs,
}: {
  server: http.Server;
  io: ReturnType<typeof createSocketServer>;
  databaseClient: ReturnType<typeof createDatabaseClient>;
  snapshotRefreshTrigger: ReturnType<typeof createSnapshotRefreshTrigger>;
  snapshotPeriodicTrigger: ReturnType<typeof createSnapshotPeriodicTrigger>;
  activeDocumentRegistry: ReturnType<typeof createActiveDocumentRegistry>;
  destroyStores?: () => void;
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
      snapshotPeriodicTrigger.stop();
    } catch (error) {
      hadError = true;
      console.error("Shutdown: snapshot trigger stop failed", error);
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

    try {
      destroyStores?.();
    } catch (error) {
      hadError = true;
      console.error("Shutdown: store cleanup failed", error);
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
