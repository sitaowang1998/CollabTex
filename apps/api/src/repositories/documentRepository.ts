import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DocumentPathConflictError,
  type DocumentRepository,
  type StoredDocument,
} from "../services/document.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../services/project.js";
import {
  isPrismaKnownRequestLikeError,
  lockActiveProject,
} from "./projectRepositoryUtils.js";

const DOCUMENT_WRITE_ROLES = ["admin", "editor"] as const;

export function createDocumentRepository(
  databaseClient: DatabaseClient,
): DocumentRepository {
  return {
    listForProject: async (projectId) => {
      return databaseClient.document.findMany({
        where: {
          projectId,
          project: {
            tombstoneAt: null,
          },
        },
        orderBy: {
          path: "asc",
        },
      });
    },
    findByPath: async (projectId, path) => {
      return databaseClient.document.findFirst({
        where: {
          projectId,
          path,
          project: {
            tombstoneAt: null,
          },
        },
      });
    },
    createDocument: async ({ projectId, actorUserId, path, kind, mime }) => {
      try {
        return await databaseClient.$transaction(async (tx) => {
          await lockActiveProject(tx, projectId);
          await assertActorCanWriteDocuments(tx, projectId, actorUserId);

          const documents = await listProjectDocuments(tx, projectId);
          assertCanCreatePath(documents, path);

          return tx.document.create({
            data: {
              projectId,
              path,
              kind,
              mime,
            },
          });
        });
      } catch (error) {
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2002") {
          throw new DocumentPathConflictError("path already exists");
        }

        throw error;
      }
    },
    ensureFolderCreatable: async ({ projectId, actorUserId, path }) => {
      await databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorCanWriteDocuments(tx, projectId, actorUserId);

        const documents = await listProjectDocuments(tx, projectId);
        assertCanCreateFolder(documents, path);
      });
    },
    moveNode: async ({ projectId, actorUserId, path, nextPath }) => {
      return databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorCanWriteDocuments(tx, projectId, actorUserId);

        const documents = await listProjectDocuments(tx, projectId);
        const movePlan = planPathMove(documents, path, nextPath);

        if (!movePlan) {
          return false;
        }

        for (const documentMove of movePlan) {
          await tx.document.update({
            where: {
              id: documentMove.id,
            },
            data: {
              path: documentMove.nextPath,
            },
          });
        }

        return true;
      });
    },
    deleteNode: async ({ projectId, actorUserId, path }) => {
      return databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorCanWriteDocuments(tx, projectId, actorUserId);

        const documents = await listProjectDocuments(tx, projectId);
        const exactDocument = documents.find(
          (document) => document.path === path,
        );

        if (exactDocument) {
          await tx.document.delete({
            where: {
              id: exactDocument.id,
            },
          });

          return true;
        }

        const descendantPaths = documents
          .filter((document) => isDescendantPath(document.path, path))
          .map((document) => document.path);

        if (descendantPaths.length === 0) {
          return false;
        }

        await tx.document.deleteMany({
          where: {
            projectId,
            path: {
              in: descendantPaths,
            },
          },
        });

        return true;
      });
    },
  };
}

type DocumentPathRow = Pick<StoredDocument, "id" | "path">;

async function listProjectDocuments(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<StoredDocument[]> {
  return tx.document.findMany({
    where: {
      projectId,
    },
    orderBy: {
      path: "asc",
    },
  });
}

async function assertActorCanWriteDocuments(
  tx: Prisma.TransactionClient,
  projectId: string,
  actorUserId: string,
): Promise<void> {
  const membership = await tx.projectMembership.findUnique({
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

  if (!membership) {
    throw new ProjectNotFoundError();
  }

  if (DOCUMENT_WRITE_ROLES.includes(membership.role)) {
    return;
  }

  if (membership.role === "admin") {
    throw new ProjectAdminRequiredError();
  }

  throw new ProjectRoleRequiredError(DOCUMENT_WRITE_ROLES);
}

function assertCanCreatePath(documents: DocumentPathRow[], path: string): void {
  if (documents.some((document) => document.path === path)) {
    throw new DocumentPathConflictError("path already exists");
  }

  if (documents.some((document) => isAncestorPath(document.path, path))) {
    throw new DocumentPathConflictError("path cannot be created under a file");
  }

  if (documents.some((document) => isDescendantPath(document.path, path))) {
    throw new DocumentPathConflictError("path already exists as a folder");
  }
}

function assertCanCreateFolder(
  documents: DocumentPathRow[],
  path: string,
): void {
  if (documents.some((document) => document.path === path)) {
    throw new DocumentPathConflictError("path already exists");
  }

  if (documents.some((document) => isAncestorPath(document.path, path))) {
    throw new DocumentPathConflictError(
      "folder cannot be created under a file",
    );
  }

  if (documents.some((document) => isDescendantPath(document.path, path))) {
    throw new DocumentPathConflictError("folder already exists");
  }
}

type PlannedMove = {
  id: string;
  currentPath: string;
  nextPath: string;
};

function planPathMove(
  documents: DocumentPathRow[],
  sourcePath: string,
  destinationPath: string,
): PlannedMove[] | null {
  const exactDocument = documents.find(
    (document) => document.path === sourcePath,
  );

  if (exactDocument) {
    if (destinationPath === sourcePath) {
      return [];
    }

    assertMoveTargetIsValid(documents, [
      {
        id: exactDocument.id,
        currentPath: sourcePath,
        nextPath: destinationPath,
      },
    ]);

    return [
      {
        id: exactDocument.id,
        currentPath: sourcePath,
        nextPath: destinationPath,
      },
    ];
  }

  const descendants = documents.filter((document) =>
    isDescendantPath(document.path, sourcePath),
  );

  if (descendants.length === 0) {
    return null;
  }

  if (
    destinationPath === sourcePath ||
    isDescendantPath(destinationPath, sourcePath)
  ) {
    throw new DocumentPathConflictError(
      "folder cannot be moved into itself or one of its descendants",
    );
  }

  const plan = descendants.map((document) => ({
    id: document.id,
    currentPath: document.path,
    nextPath: `${destinationPath}${document.path.slice(sourcePath.length)}`,
  }));

  assertMoveTargetIsValid(documents, plan);

  return plan;
}

function assertMoveTargetIsValid(
  documents: DocumentPathRow[],
  plannedMoves: PlannedMove[],
): void {
  const movingIds = new Set(plannedMoves.map((move) => move.id));
  const stationaryDocuments = documents.filter(
    (document) => !movingIds.has(document.id),
  );
  const nextPaths = plannedMoves.map((move) => move.nextPath);

  if (new Set(nextPaths).size !== nextPaths.length) {
    throw new DocumentPathConflictError(
      "destination path would create duplicates",
    );
  }

  for (const nextPath of nextPaths) {
    if (stationaryDocuments.some((document) => document.path === nextPath)) {
      throw new DocumentPathConflictError("destination path already exists");
    }

    if (
      stationaryDocuments.some((document) =>
        isAncestorPath(document.path, nextPath),
      )
    ) {
      throw new DocumentPathConflictError(
        "destination path would be nested under a file",
      );
    }

    if (
      stationaryDocuments.some((document) =>
        isDescendantPath(document.path, nextPath),
      )
    ) {
      throw new DocumentPathConflictError(
        "destination path collides with an existing folder",
      );
    }
  }
}

function isAncestorPath(ancestorPath: string, path: string): boolean {
  return path.startsWith(`${ancestorPath}/`);
}

function isDescendantPath(path: string, ancestorPath: string): boolean {
  return path.startsWith(`${ancestorPath}/`);
}
