import { io, type Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@collab-tex/shared";

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;
let socketToken: string | null = null;

export function getSocket(): TypedSocket {
  const token = localStorage.getItem("token");

  if (socket && socketToken === token) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
  }

  socket = io({
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  socketToken = token;

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketToken = null;
  }
}
