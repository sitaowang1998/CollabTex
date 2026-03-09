import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import type {
  CreateProjectInput,
  ProjectRepository,
} from "../services/project.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectOwnerNotFoundError,
} from "../services/project.js";
import type {
  ProjectWithRole,
  StoredProject,
} from "../services/projectAccess.js";

type ProjectRowWithMembership = StoredProject & {
  memberships: Array<{
    role: ProjectWithRole["myRole"];
  }>;
};

export function createProjectRepository(
  databaseClient: DatabaseClient,
): ProjectRepository {
  return {
    createForOwner: async ({ ownerUserId, name }: CreateProjectInput) => {
      try {
        return await databaseClient.$transaction(async (tx) => {
          const project = await tx.project.create({
            data: {
              name,
            },
          });

          await tx.projectMembership.create({
            data: {
              projectId: project.id,
              userId: ownerUserId,
              role: "admin",
            },
          });

          return project;
        });
      } catch (error) {
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2003") {
          throw new ProjectOwnerNotFoundError();
        }

        throw error;
      }
    },
    listForUser: async (userId) => {
      const projects = await databaseClient.project.findMany({
        where: {
          tombstoneAt: null,
          memberships: {
            some: {
              userId,
            },
          },
        },
        include: {
          memberships: {
            where: {
              userId,
            },
            select: {
              role: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      return projects.map(mapProjectWithRole);
    },
    findForUser: async (projectId, userId) => {
      const project = await databaseClient.project.findFirst({
        where: {
          id: projectId,
          tombstoneAt: null,
          memberships: {
            some: {
              userId,
            },
          },
        },
        include: {
          memberships: {
            where: {
              userId,
            },
            select: {
              role: true,
            },
          },
        },
      });

      return project ? mapProjectWithRole(project) : null;
    },
    updateName: async ({ projectId, actorUserId, name }) =>
      databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorIsAdmin(tx, projectId, actorUserId);

        return tx.project.update({
          where: {
            id: projectId,
          },
          data: {
            name,
          },
        });
      }),
    softDelete: async ({ projectId, actorUserId, deletedAt }) => {
      await databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorIsAdmin(tx, projectId, actorUserId);

        await tx.project.update({
          where: {
            id: projectId,
          },
          data: {
            tombstoneAt: deletedAt,
          },
        });
      });
    },
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

function mapProjectWithRole(
  project: ProjectRowWithMembership,
): ProjectWithRole {
  const membership = project.memberships[0];

  if (!membership) {
    throw new Error(
      "Expected project membership for user-scoped project query",
    );
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      tombstoneAt: project.tombstoneAt,
    },
    myRole: membership.role,
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
