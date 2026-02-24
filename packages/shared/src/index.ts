export type JwtPayload = {
  sub: string; // user id
};

export type LoginResponse = {
  token: string;
};

export type ServerToClientEvents = {
  "server:hello": (data: { userId: string; ts: number }) => void;
  "server:pong": (data: { n: number; ts: number }) => void;
};

export type ClientToServerEvents = {
  "client:ping": (data: { n: number }) => void;
};