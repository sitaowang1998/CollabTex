import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents
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
      credentials: true
    }
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

    socket.emit("server:hello", { userId, ts: Date.now() });

    socket.on("client:ping", (data) => {
      socket.emit("server:pong", { n: data.n, ts: Date.now() });
    });

    socket.on("disconnect", (reason) => {
      console.log("disconnect", socket.id, reason);
    });
  });

  return io;
}
