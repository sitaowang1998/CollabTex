import type { ProjectMember } from "@collab-tex/shared";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DuplicateProjectMembershipError,
  MembershipUserNotFoundError,
  type MembershipRepository,
} from "../services/membership.js";

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
    findMembership: async (projectId, userId) => {
      const membership = await databaseClient.projectMembership.findFirst({
        where: {
          projectId,
          userId,
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
      });

      return membership ? mapProjectMember(membership) : null;
    },
    createMembership: async ({ projectId, userId, role }) => {
      try {
        return await databaseClient.$transaction(async (tx) => {
          const activeProject = await tx.project.findFirst({
            where: {
              id: projectId,
              tombstoneAt: null,
            },
            select: {
              id: true,
            },
          });

          if (!activeProject) {
            return null;
          }

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
    updateMembershipRole: async ({ projectId, userId, role }) => {
      const result = await databaseClient.projectMembership.updateMany({
        where: {
          projectId,
          userId,
          project: {
            tombstoneAt: null,
          },
        },
        data: {
          role,
        },
      });

      if (result.count === 0) {
        return null;
      }

      return databaseClient.projectMembership
        .findFirst({
          where: {
            projectId,
            userId,
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
        })
        .then((membership) =>
          membership ? mapProjectMember(membership) : null,
        );
    },
    deleteMembership: async (projectId, userId) => {
      const result = await databaseClient.projectMembership.deleteMany({
        where: {
          projectId,
          userId,
          project: {
            tombstoneAt: null,
          },
        },
      });

      return result.count > 0;
    },
    countAdmins: async (projectId) =>
      databaseClient.projectMembership.count({
        where: {
          projectId,
          role: "admin",
          project: {
            tombstoneAt: null,
          },
        },
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
