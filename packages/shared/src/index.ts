export type JwtPayload = {
  sub: string; // user id
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type RegisterRequest = {
  email: string;
  name: string;
  password: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type ProjectRole = "admin" | "editor" | "commenter" | "reader";

export type DocumentKind = "text" | "binary";

export type WorkspaceJoinRequest = {
  projectId: string;
  documentId: string;
};

export type WorkspaceJoinedEvent = WorkspaceJoinRequest & {
  userId: string;
};

export type WorkspaceOpenEvent = WorkspaceJoinRequest;

export type WorkspaceErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST";

export type WorkspaceErrorEvent = {
  code: WorkspaceErrorCode;
  message: string;
};

export type ServerToClientEvents = {
  "workspace:joined": (data: WorkspaceJoinedEvent) => void;
  "workspace:open": (data: WorkspaceOpenEvent) => void;
  "workspace:error": (data: WorkspaceErrorEvent) => void;
};

export type ClientToServerEvents = {
  "workspace:join": (data: WorkspaceJoinRequest) => void;
};
