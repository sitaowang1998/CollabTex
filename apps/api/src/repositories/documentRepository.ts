import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DocumentPathConflictError,
  type DocumentRepository,
  type StoredDocument,
} from "../services/document.js";
import {
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
      assertCanonicalPersistedPath(path);

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
    moveNode: async ({ projectId, actorUserId, path, nextPath }) => {
      assertCanonicalPersistedPath(path);
      assertCanonicalPersistedPath(nextPath);

      try {
        return await databaseClient.$transaction(async (tx) => {
          await lockActiveProject(tx, projectId);
          await assertActorCanWriteDocuments(tx, projectId, actorUserId);

          const documents = await listProjectDocuments(tx, projectId);
          const movePlan = planPathMove(documents, path, nextPath);

          if (!movePlan) {
            return false;
          }

          if (movePlan.length <= 1) {
            await applyMovePlan(tx, movePlan);
            return true;
          }

          const stagedMovePlan = createStagedMovePlan(movePlan);

          await applyMovePlan(tx, stagedMovePlan);
          await applyMovePlan(tx, movePlan);

          return true;
        });
      } catch (error) {
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2002") {
          throw new DocumentPathConflictError("path already exists");
        }

        throw error;
      }
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

  if (
    DOCUMENT_WRITE_ROLES.some((allowedRole) => allowedRole === membership.role)
  ) {
    return;
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

type PlannedMove = {
  id: string;
  currentPath: string;
  nextPath: string;
};

async function applyMovePlan(
  tx: Prisma.TransactionClient,
  movePlan: PlannedMove[],
): Promise<void> {
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
}

function createStagedMovePlan(movePlan: PlannedMove[]): PlannedMove[] {
  const stagedMovePlan = movePlan.map((documentMove) => ({
    id: documentMove.id,
    currentPath: documentMove.currentPath,
    nextPath: toTemporaryStagingPath(documentMove.currentPath),
  }));

  const stagedPaths = stagedMovePlan.map(
    (documentMove) => documentMove.nextPath,
  );

  if (new Set(stagedPaths).size !== stagedPaths.length) {
    throw new Error(
      "Expected unique temporary staging paths for document move",
    );
  }

  return stagedMovePlan;
}

function toTemporaryStagingPath(path: string): string {
  assertCanonicalPersistedPath(path);

  // Persisted document paths are always absolute and start with "/".
  // Multi-row moves stage through a non-absolute namespace by stripping that
  // leading slash, which keeps staging rows disjoint from all valid real rows.
  const stagingPath = path.slice(1);

  if (!stagingPath || stagingPath.startsWith("/")) {
    throw new Error("Expected temporary staging path without leading slash");
  }

  return stagingPath;
}

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

function assertCanonicalPersistedPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(
      "Expected canonical persisted document path starting with '/'",
    );
  }
}
