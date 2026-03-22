import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  CompileDoneEvent,
  ServerToClientEvents,
  ClientDocumentUpdateEvent,
  WorkspaceErrorEvent,
  WorkspaceJoinRequest,
} from "@collab-tex/shared";
import type { AppConfig } from "../config/appConfig.js";
import type {
  ActiveDocumentRegistry,
  ActiveDocumentSessionHandle,
} from "../services/activeDocumentRegistry.js";
import { ActiveDocumentSessionInvalidatedError } from "../services/activeDocumentRegistry.js";
import { ActiveDocumentStateDocumentNotFoundError } from "../services/activeDocumentStateLoader.js";
import { verifyToken } from "../services/auth.js";
import { InvalidCollaborationUpdateError } from "../services/collaboration.js";
import { DocumentTextStateDocumentNotFoundError } from "../services/currentTextState.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  type ProjectAccessService,
} from "../services/projectAccess.js";
import {
  RealtimeDocumentNotFoundError,
  RealtimeDocumentSessionMismatchError,
  type RealtimeDocumentService,
} from "../services/realtimeDocument.js";
import type { AuthenticatedSocketData } from "../types/socket.js";
import {
  WorkspaceAccessDeniedError,
  WorkspaceDocumentNotFoundError,
  type WorkspaceService,
} from "../services/workspace.js";

export function createSocketServer(
  server: HttpServer,
  config: AppConfig,
  dependencies: {
    workspaceService: WorkspaceService;
    activeDocumentRegistry: ActiveDocumentRegistry;
    realtimeDocumentService: RealtimeDocumentService;
    projectAccessService: Pick<ProjectAccessService, "requireProjectMember">;
  },
) {
  const io = new Server<
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
    let activeDocumentId: string | null = null;
    let activeTextSession: ActiveTextSessionState | null = null;

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

      if (!activeWorkspaceRoomName || request.documentId !== activeDocumentId) {
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
      activeTextSession = null;
      activeDocumentId = null;

      if (sessionState) {
        void leaveActiveTextSession(socket, sessionState);
      }

      console.log("disconnect", socket.id, reason);
    });
  });

  return io;
}

export function createSocketDocumentResetPublisher(
  io: ReturnType<typeof createSocketServer>,
  activeDocumentRegistry: ActiveDocumentRegistry,
) {
  return {
    emitDocumentReset: async ({
      projectId,
      documentId,
      reason,
      serverVersion,
    }: {
      projectId: string;
      documentId: string;
      reason: string;
      serverVersion: number;
    }) => {
      if (reason === "snapshot_restore") {
        const { invalidatedGeneration } = activeDocumentRegistry.invalidate({
          projectId,
          documentId,
        });

        try {
          io.to(
            createTextWorkspaceRoomName(
              projectId,
              documentId,
              invalidatedGeneration,
            ),
          ).emit("doc.reset", {
            documentId,
            reason,
            serverVersion,
          });
        } catch (error) {
          // Fire-and-forget safety net — Socket.IO emit is extremely unlikely
          // to throw synchronously, but we catch to avoid crashing the caller.
          console.error(
            "Failed to broadcast doc.reset to text session",
            { projectId, documentId, reason },
            error,
          );
        }
      }

      try {
        io.to(createWorkspaceRoomName(projectId, documentId)).emit(
          "doc.reset",
          {
            documentId,
            reason,
            serverVersion,
          },
        );
      } catch (error) {
        // Fire-and-forget safety net — Socket.IO emit is extremely unlikely
        // to throw synchronously, but we catch to avoid crashing the caller.
        console.error(
          "Failed to broadcast doc.reset to workspace",
          { projectId, documentId, reason },
          error,
        );
      }
    },
  };
}

export function createCompileDonePublisher(
  io: ReturnType<typeof createSocketServer>,
) {
  return {
    emitCompileDone: (event: CompileDoneEvent) => {
      try {
        io.to(createProjectRoomName(event.projectId)).emit(
          "compile:done",
          event,
        );
      } catch (error) {
        console.error(
          "Failed to broadcast compile:done",
          { projectId: event.projectId },
          error,
        );
      }
    },
  };
}

export async function openWorkspace(
  socket: WorkspaceSocket,
  workspaceService: WorkspaceService,
  input: {
    workspaceOpenInput: {
      userId: string;
      projectId: string;
      documentId: string;
    };
    activeDocumentRegistry: ActiveDocumentRegistry;
    joinSequence: number;
    isLatestJoin: () => boolean;
    getActiveWorkspaceRoomName: () => string | null;
    setActiveWorkspaceRoomName: (roomName: string) => void;
    setActiveDocumentId: (documentId: string | null) => void;
    getActiveProjectRoomName: () => string | null;
    setActiveProjectRoomName: (roomName: string) => void;
    getActiveTextSession: () => ActiveTextSessionState | null;
    swapActiveTextSession: (
      nextSession: ActiveTextSessionState | null,
    ) => ActiveTextSessionState | null;
    revalidateAccess: (projectId: string, userId: string) => Promise<void>;
  },
): Promise<void> {
  while (input.isLatestJoin()) {
    let joinedSessionHandle: ActiveDocumentSessionHandle | null = null;
    let joinedWorkspaceRoomName: string | null = null;

    try {
      const openedWorkspace = await workspaceService.openDocument(
        input.workspaceOpenInput,
      );
      const nextActiveTextSession = openedWorkspace.initialSync
        ? await input.activeDocumentRegistry.join({
            projectId: input.workspaceOpenInput.projectId,
            documentId: input.workspaceOpenInput.documentId,
          })
        : null;

      joinedSessionHandle = nextActiveTextSession;
      const nextWorkspaceRoomName = nextActiveTextSession
        ? createTextWorkspaceRoomName(
            input.workspaceOpenInput.projectId,
            input.workspaceOpenInput.documentId,
            nextActiveTextSession.session.generation,
          )
        : createWorkspaceRoomName(
            input.workspaceOpenInput.projectId,
            input.workspaceOpenInput.documentId,
          );

      if (!input.isLatestJoin()) {
        await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
        return;
      }

      const previousWorkspaceRoomName = input.getActiveWorkspaceRoomName();

      if (
        previousWorkspaceRoomName &&
        previousWorkspaceRoomName !== nextWorkspaceRoomName
      ) {
        await socket.leave(previousWorkspaceRoomName);

        if (!input.isLatestJoin()) {
          await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
          return;
        }
      }

      await socket.join(nextWorkspaceRoomName);
      joinedWorkspaceRoomName = nextWorkspaceRoomName;

      if (!input.isLatestJoin()) {
        await leaveJoinedRoomIfNeeded(socket, input, nextWorkspaceRoomName);
        await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
        return;
      }

      if (nextActiveTextSession) {
        const syncResponse = await nextActiveTextSession.runExclusive(
          async (session) => {
            if (session.isInvalidated) {
              throw new ActiveDocumentSessionInvalidatedError();
            }

            if (!input.isLatestJoin()) {
              return null;
            }

            await input.revalidateAccess(
              input.workspaceOpenInput.projectId,
              input.workspaceOpenInput.userId,
            );

            return {
              documentId: session.documentId,
              stateB64: encodeBase64(session.document.exportUpdate()),
              serverVersion: session.serverVersion,
            };
          },
        );

        if (!syncResponse || !input.isLatestJoin()) {
          await leaveJoinedRoomIfNeeded(socket, input, nextWorkspaceRoomName);
          await leaveJoinedSessionIfNeeded(socket, input, joinedSessionHandle);
          return;
        }

        const previousSession = input.swapActiveTextSession({
          projectId: input.workspaceOpenInput.projectId,
          documentId: input.workspaceOpenInput.documentId,
          joinSequence: input.joinSequence,
          workspaceRoomName: nextWorkspaceRoomName,
          handle: nextActiveTextSession,
        });
        joinedSessionHandle = null;
        input.setActiveWorkspaceRoomName(nextWorkspaceRoomName);
        input.setActiveDocumentId(input.workspaceOpenInput.documentId);

        const projectRoomJoined = await joinProjectRoom(
          socket,
          input,
          input.workspaceOpenInput.projectId,
        );
        if (!projectRoomJoined) {
          if (previousSession) {
            void leaveActiveTextSession(socket, previousSession);
          }
          return;
        }

        socket.emit("workspace:opened", openedWorkspace.workspace);
        socket.emit("doc.sync.response", syncResponse);

        if (previousSession) {
          void leaveActiveTextSession(socket, previousSession);
        }

        return;
      }

      const previousSession = input.swapActiveTextSession(null);
      input.setActiveWorkspaceRoomName(nextWorkspaceRoomName);
      input.setActiveDocumentId(input.workspaceOpenInput.documentId);

      const projectRoomJoined = await joinProjectRoom(
        socket,
        input,
        input.workspaceOpenInput.projectId,
      );
      if (!projectRoomJoined) {
        if (previousSession) {
          void leaveActiveTextSession(socket, previousSession);
        }
        return;
      }

      socket.emit("workspace:opened", openedWorkspace.workspace);

      if (previousSession) {
        void leaveActiveTextSession(socket, previousSession);
      }

      return;
    } catch (error) {
      if (joinedWorkspaceRoomName) {
        await leaveJoinedRoomIfNeeded(socket, input, joinedWorkspaceRoomName);
      }

      if (joinedSessionHandle) {
        await leaveActiveTextSession(socket, {
          projectId: input.workspaceOpenInput.projectId,
          documentId: input.workspaceOpenInput.documentId,
          joinSequence: input.joinSequence,
          workspaceRoomName: createTextWorkspaceRoomName(
            input.workspaceOpenInput.projectId,
            input.workspaceOpenInput.documentId,
            joinedSessionHandle.session.generation,
          ),
          handle: joinedSessionHandle,
        });
      }

      if (!input.isLatestJoin()) {
        return;
      }

      if (error instanceof ActiveDocumentSessionInvalidatedError) {
        continue;
      }

      if (isUnexpectedWorkspaceError(error)) {
        console.error("Workspace open failed", input.workspaceOpenInput, error);
      }

      socket.emit("realtime:error", mapWorkspaceError(error));
      return;
    }
  }
}

async function applyDocumentUpdate(
  socket: WorkspaceSocket,
  realtimeDocumentService: RealtimeDocumentService,
  input: {
    request: ParsedDocumentUpdateRequest;
    sessionState: ActiveTextSessionState;
    userId: string;
    getActiveTextSession: () => ActiveTextSessionState | null;
  },
) {
  const isCurrentSession = () => {
    const currentSession = input.getActiveTextSession();

    return (
      currentSession?.handle === input.sessionState.handle &&
      currentSession.projectId === input.sessionState.projectId &&
      currentSession.documentId === input.sessionState.documentId &&
      currentSession.joinSequence === input.sessionState.joinSequence
    );
  };

  try {
    const result = await realtimeDocumentService.applyUpdate({
      projectId: input.sessionState.projectId,
      documentId: input.request.documentId,
      userId: input.userId,
      sessionHandle: input.sessionState.handle,
      update: input.request.update,
      isCurrentSession,
      buildAcceptedContext: ({
        session,
        isCurrentSession: isSenderCurrent,
      }) => ({
        shouldBroadcastToPeers: !session.isInvalidated,
        shouldEmitToSender: isSenderCurrent && !session.isInvalidated,
      }),
    });
    const updateEvent = {
      documentId: input.request.documentId,
      updateB64: encodeBase64(result.acceptedUpdate),
      clientUpdateId: input.request.clientUpdateId,
      serverVersion: result.serverVersion,
    };

    if (result.acceptedContext.shouldBroadcastToPeers) {
      try {
        socket
          .to(input.sessionState.workspaceRoomName)
          .emit("doc.update", updateEvent);
      } catch (error) {
        // Fire-and-forget safety net — Socket.IO emit is extremely unlikely
        // to throw synchronously, but we catch to avoid crashing the caller.
        console.error(
          "Failed to broadcast update to peers",
          {
            socketId: socket.id,
            documentId: input.request.documentId,
            roomName: input.sessionState.workspaceRoomName,
          },
          error,
        );
      }
    }

    if (result.acceptedContext.shouldEmitToSender) {
      socket.emit("doc.update", updateEvent);
      socket.emit("doc.update.ack", {
        documentId: input.request.documentId,
        clientUpdateId: input.request.clientUpdateId,
        serverVersion: result.serverVersion,
      });
    }
  } catch (error) {
    if (
      shouldSuppressStaleSessionFailure(error, {
        isCurrentSession,
      })
    ) {
      console.debug("Suppressed stale session doc.update failure", {
        socketId: socket.id,
        documentId: input.request.documentId,
        error: error instanceof Error ? error.constructor.name : String(error),
      });
      return;
    }

    if (isUnexpectedDocumentUpdateError(error)) {
      console.error(
        "Document update failed",
        {
          socketId: socket.id,
          userId: socket.data.userId,
          projectId: input.sessionState.projectId,
          documentId: input.request.documentId,
          clientUpdateId: input.request.clientUpdateId,
        },
        error,
      );
    }

    socket.emit("realtime:error", mapDocumentUpdateError(error));
  }
}

async function handleSyncRequest(
  socket: WorkspaceSocket,
  projectAccessService: Pick<ProjectAccessService, "requireProjectMember">,
  input: {
    request: { documentId: string };
    sessionState: ActiveTextSessionState;
    userId: string;
    getActiveTextSession: () => ActiveTextSessionState | null;
  },
) {
  const isCurrentSession = () => {
    const currentSession = input.getActiveTextSession();

    return (
      currentSession?.handle === input.sessionState.handle &&
      currentSession.projectId === input.sessionState.projectId &&
      currentSession.documentId === input.sessionState.documentId &&
      currentSession.joinSequence === input.sessionState.joinSequence
    );
  };

  try {
    const syncResponse = await input.sessionState.handle.runExclusive(
      async (session) => {
        if (session.isInvalidated) {
          throw new ActiveDocumentSessionInvalidatedError();
        }

        if (!isCurrentSession()) {
          throw new RealtimeDocumentSessionMismatchError();
        }

        await projectAccessService.requireProjectMember(
          input.sessionState.projectId,
          input.userId,
        );

        return {
          documentId: session.documentId,
          stateB64: encodeBase64(session.document.exportUpdate()),
          serverVersion: session.serverVersion,
        };
      },
    );

    if (!isCurrentSession()) {
      return;
    }

    socket.emit("doc.sync.response", syncResponse);
  } catch (error) {
    if (
      shouldSuppressStaleSessionFailure(error, {
        isCurrentSession,
      })
    ) {
      console.debug("Suppressed stale session doc.sync.request failure", {
        socketId: socket.id,
        documentId: input.request.documentId,
        error: error instanceof Error ? error.constructor.name : String(error),
      });
      return;
    }

    if (isUnexpectedSyncRequestError(error)) {
      console.error(
        "Sync request failed",
        {
          socketId: socket.id,
          userId: input.userId,
          projectId: input.sessionState.projectId,
          documentId: input.request.documentId,
        },
        error,
      );
    }

    socket.emit("realtime:error", mapSyncRequestError(error));
  }
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function parseWorkspaceJoinRequest(
  value: unknown,
): WorkspaceJoinRequest | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "workspace:join payload must be an object",
    };
  }

  const projectId =
    typeof value.projectId === "string" ? value.projectId.trim() : "";
  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";

  if (!projectId) {
    return {
      code: "INVALID_REQUEST",
      message: "projectId is required",
    };
  }

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  return { projectId, documentId };
}

type ParsedDocumentUpdateRequest = ClientDocumentUpdateEvent & {
  update: Uint8Array;
};

function parseDocumentUpdateRequest(
  value: unknown,
): ParsedDocumentUpdateRequest | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "doc.update payload must be an object",
    };
  }

  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";
  const updateB64 =
    typeof value.updateB64 === "string" ? value.updateB64.trim() : "";
  const clientUpdateId =
    typeof value.clientUpdateId === "string" ? value.clientUpdateId.trim() : "";

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  if (!updateB64) {
    return {
      code: "INVALID_REQUEST",
      message: "updateB64 is required",
    };
  }

  if (!clientUpdateId) {
    return {
      code: "INVALID_REQUEST",
      message: "clientUpdateId is required",
    };
  }

  try {
    return {
      documentId,
      updateB64,
      clientUpdateId,
      update: decodeBase64Update(updateB64),
    };
  } catch {
    return {
      code: "INVALID_REQUEST",
      message: "updateB64 must be a valid base64-encoded Yjs update",
    };
  }
}

function decodeBase64Update(value: string): Uint8Array {
  if (!isStrictBase64(value)) {
    throw new Error("Invalid base64");
  }

  return Buffer.from(value, "base64");
}

function isStrictBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0
    ? /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    : false;
}

function parseSyncRequest(
  value: unknown,
): { documentId: string } | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "doc.sync.request payload must be an object",
    };
  }

  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  return { documentId };
}

const MAX_AWARENESS_B64_LENGTH = 8192;

function parsePresenceUpdateRequest(
  value: unknown,
): { documentId: string; awarenessB64: string } | WorkspaceErrorEvent {
  if (!isObject(value)) {
    return {
      code: "INVALID_REQUEST",
      message: "presence.update payload must be an object",
    };
  }

  const documentId =
    typeof value.documentId === "string" ? value.documentId.trim() : "";
  const awarenessB64 =
    typeof value.awarenessB64 === "string" ? value.awarenessB64.trim() : "";

  if (!documentId) {
    return {
      code: "INVALID_REQUEST",
      message: "documentId is required",
    };
  }

  if (!awarenessB64) {
    return {
      code: "INVALID_REQUEST",
      message: "awarenessB64 is required",
    };
  }

  if (awarenessB64.length > MAX_AWARENESS_B64_LENGTH) {
    return {
      code: "INVALID_REQUEST",
      message: `awarenessB64 exceeds maximum length of ${MAX_AWARENESS_B64_LENGTH}`,
    };
  }

  if (!isStrictBase64(awarenessB64)) {
    return {
      code: "INVALID_REQUEST",
      message: "awarenessB64 must be valid base64",
    };
  }

  return { documentId, awarenessB64 };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createProjectRoomName(projectId: string): string {
  return `project:${projectId}`;
}

export function createWorkspaceRoomName(
  projectId: string,
  documentId: string,
): string {
  return `workspace:${projectId}:${documentId}`;
}

export function createTextWorkspaceRoomName(
  projectId: string,
  documentId: string,
  generation: number,
): string {
  return `workspace:${projectId}:${documentId}:text:${generation}`;
}

function mapWorkspaceError(error: unknown): WorkspaceErrorEvent {
  if (error instanceof WorkspaceAccessDeniedError) {
    return {
      code: "FORBIDDEN",
      message: "project membership required",
    };
  }

  if (error instanceof WorkspaceDocumentNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: "workspace document not found",
    };
  }

  if (error instanceof ActiveDocumentStateDocumentNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: "workspace document not found",
    };
  }

  return {
    code: "UNAVAILABLE",
    message: "workspace unavailable",
  };
}

function mapDocumentUpdateError(error: unknown): WorkspaceErrorEvent {
  if (
    error instanceof RealtimeDocumentSessionMismatchError ||
    error instanceof InvalidCollaborationUpdateError ||
    error instanceof ActiveDocumentSessionInvalidatedError
  ) {
    return {
      code: "INVALID_REQUEST",
      message:
        error instanceof RealtimeDocumentSessionMismatchError
          ? "socket is not joined to this document"
          : error instanceof ActiveDocumentSessionInvalidatedError
            ? "socket session is no longer current"
            : "update payload is not a valid Yjs update",
    };
  }

  if (error instanceof ProjectNotFoundError) {
    return {
      code: "FORBIDDEN",
      message: "project membership required",
    };
  }

  if (error instanceof ProjectRoleRequiredError) {
    return {
      code: "FORBIDDEN",
      message: "required project role missing",
    };
  }

  if (
    error instanceof RealtimeDocumentNotFoundError ||
    error instanceof DocumentTextStateDocumentNotFoundError
  ) {
    return {
      code: "NOT_FOUND",
      message: "workspace document not found",
    };
  }

  return {
    code: "UNAVAILABLE",
    message: "realtime unavailable",
  };
}

function mapSyncRequestError(error: unknown): WorkspaceErrorEvent {
  if (
    error instanceof RealtimeDocumentSessionMismatchError ||
    error instanceof ActiveDocumentSessionInvalidatedError
  ) {
    return {
      code: "INVALID_REQUEST",
      message:
        error instanceof RealtimeDocumentSessionMismatchError
          ? "socket is not joined to this document"
          : "socket session is no longer current",
    };
  }

  if (error instanceof ProjectNotFoundError) {
    return {
      code: "FORBIDDEN",
      message: "project membership required",
    };
  }

  if (error instanceof ProjectRoleRequiredError) {
    return {
      code: "FORBIDDEN",
      message: "required project role missing",
    };
  }

  return {
    code: "UNAVAILABLE",
    message: "realtime unavailable",
  };
}

function isUnexpectedSyncRequestError(error: unknown): boolean {
  return (
    !(error instanceof RealtimeDocumentSessionMismatchError) &&
    !(error instanceof ActiveDocumentSessionInvalidatedError) &&
    !(error instanceof ProjectNotFoundError) &&
    !(error instanceof ProjectRoleRequiredError)
  );
}

function isUnexpectedWorkspaceError(error: unknown): boolean {
  return (
    !(error instanceof WorkspaceAccessDeniedError) &&
    !(error instanceof WorkspaceDocumentNotFoundError) &&
    !(error instanceof ActiveDocumentStateDocumentNotFoundError)
  );
}

function isUnexpectedDocumentUpdateError(error: unknown): boolean {
  return (
    !(error instanceof RealtimeDocumentSessionMismatchError) &&
    !(error instanceof InvalidCollaborationUpdateError) &&
    !(error instanceof ActiveDocumentSessionInvalidatedError) &&
    !(error instanceof ProjectNotFoundError) &&
    !(error instanceof ProjectRoleRequiredError) &&
    !(error instanceof RealtimeDocumentNotFoundError) &&
    !(error instanceof DocumentTextStateDocumentNotFoundError)
  );
}

function shouldSuppressStaleSessionFailure(
  error: unknown,
  input: {
    isCurrentSession: () => boolean;
  },
): boolean {
  if (
    !(error instanceof RealtimeDocumentSessionMismatchError) &&
    !(error instanceof ActiveDocumentSessionInvalidatedError)
  ) {
    return false;
  }

  return !input.isCurrentSession();
}

async function joinProjectRoom(
  socket: WorkspaceSocket,
  input: {
    isLatestJoin: () => boolean;
    getActiveProjectRoomName: () => string | null;
    setActiveProjectRoomName: (roomName: string) => void;
  },
  projectId: string,
): Promise<boolean> {
  const nextProjectRoomName = createProjectRoomName(projectId);
  const previousProjectRoomName = input.getActiveProjectRoomName();

  if (
    previousProjectRoomName &&
    previousProjectRoomName !== nextProjectRoomName
  ) {
    await socket.leave(previousProjectRoomName);

    if (!input.isLatestJoin()) {
      return false;
    }
  }

  await socket.join(nextProjectRoomName);

  if (!input.isLatestJoin()) {
    await socket.leave(nextProjectRoomName);
    return false;
  }

  input.setActiveProjectRoomName(nextProjectRoomName);
  return true;
}

async function leaveJoinedRoomIfNeeded(
  socket: WorkspaceSocket,
  input: {
    getActiveWorkspaceRoomName: () => string | null;
  },
  roomName: string,
) {
  if (input.getActiveWorkspaceRoomName() === roomName) {
    return;
  }

  await socket.leave(roomName);
}

async function leaveJoinedSessionIfNeeded(
  socket: WorkspaceSocket,
  input: {
    workspaceOpenInput: { projectId: string; documentId: string };
    joinSequence: number;
  },
  joinedSessionHandle: ActiveDocumentSessionHandle | null,
) {
  if (!joinedSessionHandle) {
    return;
  }

  await leaveActiveTextSession(socket, {
    projectId: input.workspaceOpenInput.projectId,
    documentId: input.workspaceOpenInput.documentId,
    joinSequence: input.joinSequence,
    workspaceRoomName: createTextWorkspaceRoomName(
      input.workspaceOpenInput.projectId,
      input.workspaceOpenInput.documentId,
      joinedSessionHandle.session.generation,
    ),
    handle: joinedSessionHandle,
  });
}

async function leaveActiveTextSession(
  socket: WorkspaceSocket,
  sessionState: ActiveTextSessionState,
) {
  try {
    await sessionState.handle.leave();
  } catch (error) {
    console.error(
      "Failed to leave active document session",
      {
        socketId: socket.id,
        projectId: sessionState.projectId,
        documentId: sessionState.documentId,
      },
      error,
    );
  }
}

type WorkspaceSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

type ActiveTextSessionState = {
  projectId: string;
  documentId: string;
  joinSequence: number;
  workspaceRoomName: string;
  handle: ActiveDocumentSessionHandle;
};
