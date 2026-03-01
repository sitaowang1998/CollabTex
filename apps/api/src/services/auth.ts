import jwt from "jsonwebtoken";
import type { JwtPayload } from "@collab-tex/shared";

export function signToken(userId: string, jwtSecret: string): string {
  const payload: JwtPayload = { sub: userId };

  return jwt.sign(payload, jwtSecret, { expiresIn: "15m" });
}

export function verifyToken(token: string, jwtSecret: string): JwtPayload {
  return jwt.verify(token, jwtSecret) as JwtPayload;
}
