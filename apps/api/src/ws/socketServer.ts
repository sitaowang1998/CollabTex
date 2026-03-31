import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@collab-tex/shared";
import type { AppConfig } from "../config/appConfig.js";
import type { ActiveDocumentRegistry } from "../services/activeDocumentRegistry.js";
import { verifyToken } from "../services/auth.js";
import {
  ProjectNotFoundError,
  type ProjectAccessService,
} from "../services/projectAccess.js";
import { WorkspaceAccessDeniedError } from "../services/workspace.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { RealtimeDocumentService } from "../services/realtimeDocument.js";
import type { AuthenticatedSocketData } from "../types/socket.js";
import {
  broadcastAwarenessRemoval,
  extractAwarenessClock,
} from "./awareness.js";
import {
  openWorkspace,
  applyDocumentUpdate,
  handleSyncRequest,
} from "./handlers.js";
import {
  parseWorkspaceJoinRequest,
  parseDocumentUpdateRequest,
  parseSyncRequest,
  parsePresenceUpdateRequest,
} from "./parsers.js";
import { leaveActiveTextSession } from "./sessionHelpers.js";
import type { ActiveTextSessionState, SocketIOServer } from "./types.js";

// Barrel re-exports — preserves all existing import paths
export {
  createProjectRoomName,
  createWorkspaceRoomName,
  createTextWorkspaceRoomName,
} from "./roomNames.js";
export {
  createSocketDocumentResetPublisher,
  createCompileDonePublisher,
  createCommentPublisher,
  createFileTreePublisher,
  createSnapshotPublisher,
} from "./publishers.js";
export type {
  CommentPublisher,
  FileTreePublisher,
  SnapshotPublisher,
} from "./publishers.js";
export { openWorkspace } from "./handlers.js";
export type {
  WorkspaceSocket,
  ActiveTextSessionState,
  SocketIOServer,
} from "./types.js";

export function createSocketServer(
  server: HttpServer,
  config: AppConfig,
  dependencies: {
    workspaceService: WorkspaceService;
    activeDocumentRegistry: ActiveDocumentRegistry;
    realtimeDocumentService: RealtimeDocumentService;
    projectAccessService: Pick<ProjectAccessService, "requireProjectMember">;
    touchProjectUpdatedAt: (projectId: string) => Promise<void>;
    queueProjectSnapshot: (
      projectId: string,
      userId: string | null,
    ) => Promise<void>;
  },
): SocketIOServer {
  const io: SocketIOServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >(server, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        next(new Error("missing token"));
        return;
      }

      const payload = verifyToken(token, config.jwtSecret);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    let latestJoinSequence = 0;
    let activeWorkspaceRoomName: string | null = null;
    let activeProjectRoomName: string | null = null;
    let activeProjectId: string | null = null;
    let activeDocumentId: string | null = null;
    let activeTextSession: ActiveTextSessionState | null = null;
    let activeAwarenessClientID: number | null = null;
    let activeAwarenessClock = 0;

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.on("workspace:join", (payload) => {
      const request = parseWorkspaceJoinRequest(payload);

      if ("code" in request) {
        socket.emit("realtime:error", request);
        return;
      }

      // Broadcast awareness removal for the previous document before switching
      const previousRoomName = activeWorkspaceRoomName;
      const previousDocumentId = activeDocumentId;
      const previousClientID = activeAwarenessClientID;
      const previousClock = activeAwarenessClock;
      if (
        previousRoomName &&
        previousDocumentId &&
        previousClientID !== null &&
        previousDocumentId !== request.documentId
      ) {
        broadcastAwarenessRemoval(
          socket,
          previousRoomName,
          previousDocumentId,
          previousClientID,
          previousClock,
        );
      }

      activeAwarenessClientID =
        typeof request.awarenessClientID === "number"
          ? request.awarenessClientID
          : null;
      activeAwarenessClock = 0;

      latestJoinSequence += 1;
      const joinSequence = latestJoinSequence;
      const workspaceOpenInput = {
        userId,
        projectId: request.projectId,
        documentId: request.documentId,
      };

      void openWorkspace(socket, dependencies.workspaceService, {
        activeDocumentRegistry: dependencies.activeDocumentRegistry,
        workspaceOpenInput,
        joinSequence,
        isLatestJoin: () => joinSequence === latestJoinSequence,
        getActiveWorkspaceRoomName: () => activeWorkspaceRoomName,
        setActiveWorkspaceRoomName: (roomName) => {
          activeWorkspaceRoomName = roomName;
        },
        setActiveDocumentId: (documentId) => {
          activeDocumentId = documentId;
        },
        getActiveProjectRoomName: () => activeProjectRoomName,
        setActiveProjectRoomName: (roomName) => {
          activeProjectRoomName = roomName;
        },
        setActiveProjectId: (projectId) => {
          activeProjectId = projectId;
        },
        getActiveTextSession: () => activeTextSession,
        swapActiveTextSession: (nextSession) => {
          const previousSession = activeTextSession;
          activeTextSession = nextSession;

          if (previousSession?.handle === nextSession?.handle) {
            return null;
          }

          return previousSession;
        },
        revalidateAccess: async (projectId, accessUserId) => {
          try {
            await dependencies.projectAccessService.requireProjectMember(
              projectId,
              accessUserId,
            );
          } catch (error) {
            if (error instanceof ProjectNotFoundError) {
              throw new WorkspaceAccessDeniedError();
            }

            throw error;
          }
        },
      });
    });

    socket.on("doc.update", (payload) => {
      const request = parseDocumentUpdateRequest(payload);

      if ("code" in request) {
        socket.emit("realtime:error", request);
        return;
      }

      const sessionState = activeTextSession;

      if (!sessionState || request.documentId !== sessionState.documentId) {
        socket.emit("realtime:error", {
          code: "INVALID_REQUEST",
          message: "socket is not joined to this document",
        });
        return;
      }

      void applyDocumentUpdate(socket, dependencies.realtimeDocumentService, {
        request,
        sessionState,
        userId,
        getActiveTextSession: () => activeTextSession,
      });
    });

    socket.on("doc.sync.request", (payload) => {
      const request = parseSyncRequest(payload);

      if ("code" in request) {
        socket.emit("realtime:error", request);
        return;
      }

      const sessionState = activeTextSession;

      if (!sessionState || request.documentId !== sessionState.documentId) {
        socket.emit("realtime:error", {
          code: "INVALID_REQUEST",
          message: "socket is not joined to this document",
        });
        return;
      }

      void handleSyncRequest(socket, dependencies.projectAccessService, {
        request,
        sessionState,
        userId,
        getActiveTextSession: () => activeTextSession,
      });
    });

    socket.on("presence.update", (payload) => {
      const request = parsePresenceUpdateRequest(payload);

      if ("code" in request) {
        socket.emit("realtime:error", request);
        return;
      }

      if (
        !activeWorkspaceRoomName ||
        request.documentId !== activeDocumentId ||
        !socket.rooms.has(activeWorkspaceRoomName)
      ) {
        socket.emit("realtime:error", {
          code: "INVALID_REQUEST",
          message: "socket is not joined to this document",
        });
        return;
      }

      try {
        socket.to(activeWorkspaceRoomName).emit("presence.update", {
          documentId: request.documentId,
          awarenessB64: request.awarenessB64,
        });
        // Track the awareness clock for removal broadcasts on disconnect
        const clock = extractAwarenessClock(request.awarenessB64);
        if (clock !== null && clock > activeAwarenessClock) {
          activeAwarenessClock = clock;
        }
      } catch (error) {
        console.error(
          "Failed to broadcast presence update",
          { socketId: socket.id, documentId: request.documentId },
          error,
        );
      }
    });

    socket.on("disconnect", (reason) => {
      const sessionState = activeTextSession;
      const disconnectedProjectId = activeProjectId;
      const disconnectedRoomName = activeWorkspaceRoomName;
      const disconnectedDocumentId = activeDocumentId;
      const disconnectedClientID = activeAwarenessClientID;
      const disconnectedClock = activeAwarenessClock;
      activeTextSession = null;
      activeDocumentId = null;
      activeProjectId = null;
      activeAwarenessClientID = null;
      activeAwarenessClock = 0;

      // Broadcast awareness removal to remaining peers
      if (
        disconnectedRoomName &&
        disconnectedDocumentId &&
        disconnectedClientID !== null
      ) {
        broadcastAwarenessRemoval(
          socket,
          disconnectedRoomName,
          disconnectedDocumentId,
          disconnectedClientID,
          disconnectedClock,
        );
      }

      if (sessionState) {
        void leaveActiveTextSession(socket, sessionState);
      }

      // Fire-and-forget — best-effort timestamp update and snapshot;
      // the user is already leaving so there is no one to notify of failure.
      if (disconnectedProjectId) {
        void dependencies
          .touchProjectUpdatedAt(disconnectedProjectId)
          .catch((error) => {
            console.error(
              "Failed to touch project timestamp on disconnect",
              { socketId: socket.id, projectId: disconnectedProjectId },
              error,
            );
          });
        void dependencies
          .queueProjectSnapshot(
            disconnectedProjectId,
            socket.data.userId ?? null,
          )
          .catch((error) => {
            console.error(
              "Failed to queue snapshot on disconnect",
              { socketId: socket.id, projectId: disconnectedProjectId },
              error,
            );
          });
      }

      console.log("disconnect", socket.id, reason);
    });
  });

  return io;
}
