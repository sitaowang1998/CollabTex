import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  assertActorIsAdmin,
  isPrismaKnownRequestLikeError,
  lockActiveProject,
} from "./projectRepositoryUtils.js";
import type {
  CreateProjectInput,
  ProjectRepository,
} from "../services/project.js";
import {
  InvalidMainDocumentError,
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
    findActiveById: async (projectId) => {
      return databaseClient.project.findFirst({
        where: {
          id: projectId,
          tombstoneAt: null,
        },
      });
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
    getMainDocumentId: async (projectId) => {
      const project = await databaseClient.project.findFirst({
        where: { id: projectId, tombstoneAt: null },
        select: { mainDocumentId: true },
      });
      return project?.mainDocumentId ?? null;
    },
    touchUpdatedAt: async (projectId) => {
      await databaseClient.$executeRaw`
        UPDATE "Project" SET "updatedAt" = NOW()
        WHERE id = ${projectId}::uuid AND "tombstoneAt" IS NULL
      `;
    },
    setMainDocumentId: async ({ projectId, documentId }) => {
      try {
        await databaseClient.$transaction(async (tx) => {
          await lockActiveProject(tx, projectId);

          await tx.project.update({
            where: { id: projectId },
            data: { mainDocumentId: documentId },
          });
        });
      } catch (error) {
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2002") {
          throw new InvalidMainDocumentError(
            "document is already the main document of another project",
          );
        }
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2003") {
          throw new InvalidMainDocumentError("document no longer exists");
        }
        throw error;
      }
    },
  };
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
