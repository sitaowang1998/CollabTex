import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  WorkspaceErrorEvent,
  WorkspaceJoinRequest,
} from "@collab-tex/shared";
import type { AppConfig } from "../config/appConfig.js";
import { verifyToken } from "../services/auth.js";
import type { AuthenticatedSocketData } from "../types/socket.js";

export function createSocketServer(server: HttpServer, config: AppConfig) {
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

      socket.emit("workspace:joined", {
        projectId: request.projectId,
        documentId: request.documentId,
        userId,
      });
      socket.emit("workspace:open", request);
    });

    socket.on("disconnect", (reason) => {
      console.log("disconnect", socket.id, reason);
    });
  });

  return io;
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
