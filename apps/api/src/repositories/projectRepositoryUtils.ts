import { Prisma } from "@prisma/client";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
} from "../services/project.js";

export function isPrismaKnownRequestLikeError(
  error: unknown,
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export async function lockActiveProject(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "Project"
    WHERE id = CAST(${projectId} AS uuid)
      AND "tombstoneAt" IS NULL
    FOR UPDATE
  `);

  if (rows.length === 0) {
    throw new ProjectNotFoundError();
  }
}

export async function assertActorIsAdmin(
  tx: Prisma.TransactionClient,
  projectId: string,
  actorUserId: string,
): Promise<void> {
  const actorMembership = await tx.projectMembership.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: actorUserId,
      },
    },
    select: {
      role: true,
    },
  });

  if (!actorMembership) {
    throw new ProjectNotFoundError();
  }

  if (actorMembership.role !== "admin") {
    throw new ProjectAdminRequiredError();
  }
}
