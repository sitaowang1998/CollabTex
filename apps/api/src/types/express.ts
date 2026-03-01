import type { Request } from "express";

export type RequestWithUserId = Request & {
  userId?: string;
};

export type AuthenticatedRequest = Request & {
  userId: string;
};
