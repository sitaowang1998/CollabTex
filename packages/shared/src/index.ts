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

export type ServerToClientEvents = {
  "server:hello": (data: { userId: string; ts: number }) => void;
  "server:pong": (data: { n: number; ts: number }) => void;
};

export type ClientToServerEvents = {
  "client:ping": (data: { n: number }) => void;
};
