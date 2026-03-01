import jwt from "jsonwebtoken";
import type { JwtPayload } from "@collab-tex/shared";

export function signToken(userId: string, jwtSecret: string): string {
  const payload: JwtPayload = { sub: userId };

  return jwt.sign(payload, jwtSecret, {
    algorithm: "HS256",
    expiresIn: "15m"
  });
}

export function verifyToken(token: string, jwtSecret: string): JwtPayload {
  const decoded = jwt.verify(token, jwtSecret, {
    algorithms: ["HS256"]
  });

  if (!isJwtPayload(decoded)) {
    throw new Error("Invalid token payload");
  }

  return { sub: decoded.sub };
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { sub?: unknown };

  return typeof candidate.sub === "string";
}
