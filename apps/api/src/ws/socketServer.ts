import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
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
import { ActiveDocumentStateDocumentNotFoundError } from "../services/activeDocumentStateLoader.js";
import { verifyToken } from "../services/auth.js";
import { InvalidCollaborationUpdateError } from "../services/collaboration.js";
import { DocumentTextStateDocumentNotFoundError } from "../services/currentTextState.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
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
        getActiveTextSession: () => activeTextSession,
        replaceActiveTextSession: async (nextSession) => {
          const previousSession = activeTextSession;
          activeTextSession = nextSession;

          if (
            previousSession &&
            previousSession.handle !== nextSession?.handle
          ) {
            await leaveActiveTextSession(socket, previousSession);
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
        getActiveTextSession: () => activeTextSession,
      });
    });

    socket.on("disconnect", (reason) => {
      const sessionState = activeTextSession;
      activeTextSession = null;

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
      io.to(createWorkspaceRoomName(projectId, documentId)).emit("doc.reset", {
        documentId,
        reason,
        serverVersion,
      });
    },
  };
}

async function openWorkspace(
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
    getActiveTextSession: () => ActiveTextSessionState | null;
    replaceActiveTextSession: (
      nextSession: ActiveTextSessionState | null,
    ) => Promise<void>;
  },
): Promise<void> {
  let joinedSessionHandle: ActiveDocumentSessionHandle | null = null;

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
    const nextWorkspaceRoomName = createWorkspaceRoomName(
      input.workspaceOpenInput.projectId,
      input.workspaceOpenInput.documentId,
    );

    if (!input.isLatestJoin()) {
      if (nextActiveTextSession) {
        await leaveActiveTextSession(socket, {
          projectId: input.workspaceOpenInput.projectId,
          documentId: input.workspaceOpenInput.documentId,
          joinSequence: input.joinSequence,
          handle: nextActiveTextSession,
        });
      }
      return;
    }

    const previousWorkspaceRoomName = input.getActiveWorkspaceRoomName();

    if (
      previousWorkspaceRoomName &&
      previousWorkspaceRoomName !== nextWorkspaceRoomName
    ) {
      void socket.leave(previousWorkspaceRoomName);
    }

    void socket.join(nextWorkspaceRoomName);
    input.setActiveWorkspaceRoomName(nextWorkspaceRoomName);
    await input.replaceActiveTextSession(
      nextActiveTextSession
        ? {
            projectId: input.workspaceOpenInput.projectId,
            documentId: input.workspaceOpenInput.documentId,
            joinSequence: input.joinSequence,
            handle: nextActiveTextSession,
          }
        : null,
    );
    joinedSessionHandle = null;
    socket.emit("workspace:opened", openedWorkspace.workspace);

    if (openedWorkspace.initialSync) {
      socket.emit("doc.sync.response", {
        documentId: openedWorkspace.initialSync.documentId,
        stateB64: encodeBase64(openedWorkspace.initialSync.yjsState),
        serverVersion: openedWorkspace.initialSync.serverVersion,
      });
    }
  } catch (error) {
    if (joinedSessionHandle) {
      await leaveActiveTextSession(socket, {
        projectId: input.workspaceOpenInput.projectId,
        documentId: input.workspaceOpenInput.documentId,
        joinSequence: input.joinSequence,
        handle: joinedSessionHandle,
      });
    }

    if (!input.isLatestJoin()) {
      return;
    }

    if (isUnexpectedWorkspaceError(error)) {
      console.error("Workspace open failed", input.workspaceOpenInput, error);
    }

    socket.emit("realtime:error", mapWorkspaceError(error));
  }
}

async function applyDocumentUpdate(
  socket: WorkspaceSocket,
  realtimeDocumentService: RealtimeDocumentService,
  input: {
    request: ParsedDocumentUpdateRequest;
    sessionState: ActiveTextSessionState;
    getActiveTextSession: () => ActiveTextSessionState | null;
  },
) {
  try {
    const result = await realtimeDocumentService.applyUpdate({
      projectId: input.sessionState.projectId,
      documentId: input.request.documentId,
      userId: socket.data.userId ?? "",
      sessionHandle: input.sessionState.handle,
      update: input.request.update,
      isCurrentSession: () => {
        const currentSession = input.getActiveTextSession();

        return (
          currentSession?.handle === input.sessionState.handle &&
          currentSession.projectId === input.sessionState.projectId &&
          currentSession.documentId === input.sessionState.documentId &&
          currentSession.joinSequence === input.sessionState.joinSequence
        );
      },
    });

    socket.emit("doc.update.ack", {
      documentId: input.request.documentId,
      clientUpdateId: input.request.clientUpdateId,
      serverVersion: result.serverVersion,
    });
    socket
      .to(
        createWorkspaceRoomName(
          input.sessionState.projectId,
          input.request.documentId,
        ),
      )
      .emit("doc.update", {
        documentId: input.request.documentId,
        updateB64: input.request.updateB64,
        clientUpdateId: input.request.clientUpdateId,
        serverVersion: result.serverVersion,
      });
  } catch (error) {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createWorkspaceRoomName(
  projectId: string,
  documentId: string,
): string {
  return `workspace:${projectId}:${documentId}`;
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
    error instanceof InvalidCollaborationUpdateError
  ) {
    return {
      code: "INVALID_REQUEST",
      message:
        error instanceof RealtimeDocumentSessionMismatchError
          ? "socket is not joined to this document"
          : "updateB64 must be a valid base64-encoded Yjs update",
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
    !(error instanceof ProjectNotFoundError) &&
    !(error instanceof ProjectRoleRequiredError) &&
    !(error instanceof RealtimeDocumentNotFoundError) &&
    !(error instanceof DocumentTextStateDocumentNotFoundError)
  );
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
  handle: ActiveDocumentSessionHandle;
};
