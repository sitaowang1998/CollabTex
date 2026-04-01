import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@collab-tex/shared";
import type { ActiveDocumentSessionHandle } from "../services/activeDocumentRegistry.js";
import type { AuthenticatedSocketData } from "../types/socket.js";

export type SocketIOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

export type WorkspaceSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

export type ActiveTextSessionState = {
  projectId: string;
  documentId: string;
  joinSequence: number;
  workspaceRoomName: string;
  handle: ActiveDocumentSessionHandle;
};
