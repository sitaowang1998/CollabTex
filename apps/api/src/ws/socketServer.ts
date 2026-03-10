import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  WorkspaceErrorEvent,
  WorkspaceJoinRequest,
} from "@collab-tex/shared";
import type { AppConfig } from "../config/appConfig.js";
import { verifyToken } from "../services/auth.js";
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

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socket.on("workspace:join", (payload) => {
      const request = parseWorkspaceJoinRequest(payload);

      if ("code" in request) {
        socket.emit("workspace:error", request);
        return;
      }

      void openWorkspace(socket, dependencies.workspaceService, {
        userId,
        projectId: request.projectId,
        documentId: request.documentId,
      });
    });

    socket.on("disconnect", (reason) => {
      console.log("disconnect", socket.id, reason);
    });
  });

  return io;
}

async function openWorkspace(
  socket: WorkspaceSocket,
  workspaceService: WorkspaceService,
  input: {
    userId: string;
    projectId: string;
    documentId: string;
  },
): Promise<void> {
  try {
    const openedWorkspace = await workspaceService.openDocument(input);

    socket.join(createWorkspaceRoomName(input.projectId, input.documentId));
    socket.emit("workspace:opened", openedWorkspace);
  } catch (error) {
    socket.emit("workspace:error", mapWorkspaceError(error));
  }
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createWorkspaceRoomName(
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

  if (error instanceof Error) {
    return {
      code: "INVALID_REQUEST",
      message: error.message,
    };
  }

  return {
    code: "INVALID_REQUEST",
    message: "unknown workspace error",
  };
}

type WorkspaceSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;
