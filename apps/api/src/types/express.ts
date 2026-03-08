import type { Request } from "express";
import type { AuthUser } from "@collab-tex/shared";

export type RequestWithUserId = Request & {
  userId?: string;
  authUser?: AuthUser;
};

export type AuthenticatedRequest = Request & {
  userId: string;
  authUser: AuthUser;
};
