import { Prisma } from "@prisma/client";
import type { ProjectMember } from "@collab-tex/shared";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DuplicateProjectMembershipError,
  LastProjectAdminRemovalError,
  MembershipUserNotFoundError,
  type MembershipRepository,
} from "../services/membership.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
} from "../services/project.js";
import { ProjectAdminOrSelfRequiredError } from "../services/membership.js";

type MembershipRow = {
  userId: string;
  role: ProjectMember["role"];
  user: {
    email: string;
    name: string;
  };
};

export function createMembershipRepository(
  databaseClient: DatabaseClient,
): MembershipRepository {
  return {
    listMembers: async (projectId) => {
      const memberships = await databaseClient.projectMembership.findMany({
        where: {
          projectId,
          project: {
            tombstoneAt: null,
          },
        },
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      });

      return memberships.map(mapProjectMember);
    },
    createMembership: async ({ projectId, actorUserId, userId, role }) => {
      try {
        return await databaseClient.$transaction(async (tx) => {
          await lockActiveProject(tx, projectId);
          await assertActorIsAdmin(tx, projectId, actorUserId);

          const membership = await tx.projectMembership.create({
            data: {
              projectId,
              userId,
              role,
            },
            include: {
              user: {
                select: {
                  email: true,
                  name: true,
                },
              },
            },
          });

          return mapProjectMember(membership);
        });
      } catch (error) {
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2002") {
          throw new DuplicateProjectMembershipError();
        }

        if (isPrismaKnownRequestLikeError(error) && error.code === "P2003") {
          throw new MembershipUserNotFoundError();
        }

        throw error;
      }
    },
    updateMembershipRole: async ({ projectId, actorUserId, userId, role }) =>
      databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorIsAdmin(tx, projectId, actorUserId);

        const membership = await tx.projectMembership.findUnique({
          where: {
            projectId_userId: {
              projectId,
              userId,
            },
          },
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        });

        if (!membership) {
          return null;
        }

        if (membership.role === "admin" && role !== "admin") {
          await assertNotLastAdmin(tx, projectId);
        }

        const updatedMembership = await tx.projectMembership.update({
          where: {
            projectId_userId: {
              projectId,
              userId,
            },
          },
          data: {
            role,
          },
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        });

        return mapProjectMember(updatedMembership);
      }),
    deleteMembership: async ({ projectId, actorUserId, userId }) =>
      databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorCanDeleteMember(tx, projectId, actorUserId, userId);

        const membership = await tx.projectMembership.findUnique({
          where: {
            projectId_userId: {
              projectId,
              userId,
            },
          },
          select: {
            role: true,
          },
        });

        if (!membership) {
          return false;
        }

        if (membership.role === "admin") {
          await assertNotLastAdmin(tx, projectId);
        }

        await tx.projectMembership.delete({
          where: {
            projectId_userId: {
              projectId,
              userId,
            },
          },
        });

        return true;
      }),
  };
}

function isPrismaKnownRequestLikeError(
  error: unknown,
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function mapProjectMember(membership: MembershipRow): ProjectMember {
  return {
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
  };
}

async function lockActiveProject(
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

async function assertNotLastAdmin(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  const adminCount = await tx.projectMembership.count({
    where: {
      projectId,
      role: "admin",
    },
  });

  if (adminCount <= 1) {
    throw new LastProjectAdminRemovalError();
  }
}

async function assertActorIsAdmin(
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

async function assertActorCanDeleteMember(
  tx: Prisma.TransactionClient,
  projectId: string,
  actorUserId: string,
  targetUserId: string,
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

  if (actorMembership.role !== "admin" && actorUserId !== targetUserId) {
    throw new ProjectAdminOrSelfRequiredError();
  }
}
