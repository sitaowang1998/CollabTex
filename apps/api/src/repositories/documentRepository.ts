import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DOCUMENT_WRITE_ROLES,
  DocumentPathConflictError,
  normalizeDocumentPath,
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
import { queueSnapshotRefreshJob } from "./snapshotRefreshJobRepository.js";

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
    findById: async (projectId, documentId) => {
      return databaseClient.document.findFirst({
        where: {
          id: documentId,
          projectId,
          project: {
            tombstoneAt: null,
          },
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

          await assertCanCreatePath(tx, projectId, path);

          const createdDocument = await tx.document.create({
            data: {
              projectId,
              path,
              kind,
              mime,
            },
          });

          await queueSnapshotRefreshJob(tx, {
            projectId,
            requestedByUserId: actorUserId,
          });

          return createdDocument;
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
            await queueSnapshotRefreshJob(tx, {
              projectId,
              requestedByUserId: actorUserId,
            });
            return true;
          }

          const stagedMovePlan = createStagedMovePlan(movePlan);

          await applyMovePlan(tx, stagedMovePlan);
          await applyMovePlan(tx, movePlan);
          await queueSnapshotRefreshJob(tx, {
            projectId,
            requestedByUserId: actorUserId,
          });

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
      assertCanonicalPersistedPath(path);

      return databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorCanWriteDocuments(tx, projectId, actorUserId);

        const exactDocument = await tx.document.findFirst({
          where: {
            projectId,
            path,
          },
          select: {
            id: true,
          },
        });

        if (exactDocument) {
          await tx.document.delete({
            where: {
              id: exactDocument.id,
            },
          });
          await queueSnapshotRefreshJob(tx, {
            projectId,
            requestedByUserId: actorUserId,
          });

          return true;
        }

        const deletedDescendants = await tx.document.deleteMany({
          where: {
            projectId,
            path: {
              // Folder-like deletes are prefix-based over canonical absolute
              // paths, so "/docs/" matches descendants but not siblings like
              // "/docs-2/...".
              startsWith: `${path}/`,
            },
          },
        });

        if (deletedDescendants.count > 0) {
          await queueSnapshotRefreshJob(tx, {
            projectId,
            requestedByUserId: actorUserId,
          });
        }

        return deletedDescendants.count > 0;
      });
    },
  };
}

type DocumentPathRow = Pick<StoredDocument, "id" | "path">;

async function listProjectDocuments(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<DocumentPathRow[]> {
  return tx.document.findMany({
    where: {
      projectId,
    },
    select: {
      id: true,
      path: true,
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

async function assertCanCreatePath(
  tx: Prisma.TransactionClient,
  projectId: string,
  path: string,
): Promise<void> {
  const ancestorPaths = getAncestorPaths(path);
  const [exactDocument, ancestorDocument, descendantDocument] =
    await Promise.all([
      tx.document.findFirst({
        where: {
          projectId,
          path,
        },
        select: {
          id: true,
        },
      }),
      ancestorPaths.length === 0
        ? Promise.resolve(null)
        : tx.document.findFirst({
            where: {
              projectId,
              path: {
                in: ancestorPaths,
              },
            },
            select: {
              id: true,
            },
          }),
      tx.document.findFirst({
        where: {
          projectId,
          path: {
            startsWith: `${path}/`,
          },
        },
        select: {
          id: true,
        },
      }),
    ]);

  if (exactDocument) {
    throw new DocumentPathConflictError("path already exists");
  }

  if (ancestorDocument) {
    throw new DocumentPathConflictError("path cannot be created under a file");
  }

  if (descendantDocument) {
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

  // Unchanged folder drags/renames are valid no-ops and should behave the
  // same as unchanged file moves above.
  if (destinationPath === sourcePath) {
    return [];
  }

  if (isDescendantPath(destinationPath, sourcePath)) {
    throw new DocumentPathConflictError(
      "folder cannot be moved into itself or one of its descendants",
    );
  }

  const plan = descendants.map((document) => ({
    id: document.id,
    currentPath: document.path,
    // Revalidate each rewritten descendant path so long subtree moves fail as
    // a deterministic validation error before any write reaches the database.
    nextPath: normalizeDocumentPath(
      `${destinationPath}${document.path.slice(sourcePath.length)}`,
    ),
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

function getAncestorPaths(path: string): string[] {
  const ancestors: string[] = [];
  let currentPath = path;

  while (true) {
    const lastSlashIndex = currentPath.lastIndexOf("/");

    if (lastSlashIndex <= 0) {
      return ancestors;
    }

    currentPath = currentPath.slice(0, lastSlashIndex);
    ancestors.push(currentPath);
  }
}

function assertCanonicalPersistedPath(path: string): void {
  let normalizedPath: string;

  try {
    normalizedPath = normalizeDocumentPath(path);
  } catch {
    throw new Error(
      "Expected canonical persisted document path (absolute, non-root, and already normalized)",
    );
  }

  if (path !== normalizedPath) {
    throw new Error(
      "Expected canonical persisted document path (absolute, non-root, and already normalized)",
    );
  }
}
