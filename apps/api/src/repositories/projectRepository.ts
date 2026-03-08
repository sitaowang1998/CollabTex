import type { DatabaseClient } from "../infrastructure/db/client.js";
import type {
  CreateProjectInput,
  ProjectRepository,
  ProjectWithRole,
  StoredProject,
} from "../services/project.js";
import { ProjectOwnerNotFoundError } from "../services/project.js";

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
    updateName: async (projectId, name) => {
      const result = await databaseClient.project.updateMany({
        where: {
          id: projectId,
          tombstoneAt: null,
        },
        data: {
          name,
        },
      });

      if (result.count === 0) {
        return null;
      }

      return databaseClient.project.findFirst({
        where: {
          id: projectId,
          tombstoneAt: null,
        },
      });
    },
    softDelete: async (projectId, deletedAt) => {
      const result = await databaseClient.project.updateMany({
        where: {
          id: projectId,
          tombstoneAt: null,
        },
        data: {
          tombstoneAt: deletedAt,
        },
      });

      return result.count > 0;
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
