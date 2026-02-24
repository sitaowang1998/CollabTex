import express, { Request, Response, NextFunction } from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  JwtPayload,
  LoginResponse
} from "@collab-tex/shared";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev_secret_change_me";
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.json());

// --- Helpers ---
function signToken(userId: string) {
  const payload: JwtPayload = { sub: userId };
  // short expiry for demo; adjust for your app
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
}

function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// --- HTTP: public health ---
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ ok: true });
});

// --- HTTP: login (demo) ---
app.post("/api/login", (req: Request, res: Response) => {
  const { username } = req.body as { username?: string };
  if (!username) return res.status(400).json({ error: "username required" });

  const token = signToken(username);
  const response: LoginResponse = { token };
  res.json(response);
});

// --- HTTP: JWT auth middleware ---
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return res.status(401).json({ error: "missing token" });

  try {
    const payload = verifyToken(token);
    // attach user id for handlers
    (req as any).userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

// --- HTTP: protected route example ---
app.get("/api/me", requireAuth, (req: Request, res: Response) => {
  res.json({ userId: (req as any).userId });
});

// --- Create HTTP server (IMPORTANT for socket.io) ---
const server = http.createServer(app);

// --- Socket.io server ---
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "http://localhost:5173",
    credentials: true
  }
});

// --- Socket.io JWT middleware ---
// The client will provide token via: io("/", { auth: { token } })
io.use((socket: Socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("missing token"));

    const payload = verifyToken(token);
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(new Error("invalid token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId as string;

  socket.emit("server:hello", { userId, ts: Date.now() });

  socket.on("client:ping", (data) => {
    socket.emit("server:pong", { n: data.n, ts: Date.now() });
  });

  socket.on("disconnect", (reason) => {
    console.log("disconnect", socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`API+Socket.io listening on http://localhost:${PORT}`);
});