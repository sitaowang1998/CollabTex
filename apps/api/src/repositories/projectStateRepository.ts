import { Prisma } from "@prisma/client";
import type { DocumentKind } from "@collab-tex/shared";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { DOCUMENT_WRITE_ROLES } from "../services/document.js";
import type { StoredSnapshot } from "../services/snapshot.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../services/project.js";
import { lockActiveProject } from "./projectRepositoryUtils.js";

export type RestoredProjectDocumentState = {
  documentId: string;
  path: string;
  kind: DocumentKind;
  mime: string | null;
  textContent: string | null;
  yjsState: Uint8Array | null;
};

export type ProjectStateRepository = {
  restoreProjectState: (input: {
    projectId: string;
    actorUserId: string;
    restoredDocuments: RestoredProjectDocumentState[];
    checkpointSnapshot: {
      storagePath: string;
      message: string | null;
      authorId: string | null;
    };
  }) => Promise<{
    snapshot: StoredSnapshot;
    affectedTextDocumentIds: string[];
  }>;
};

type ExistingDocumentUpdate = {
  id: string;
  currentPath: string;
  nextPath: string;
  kind: DocumentKind;
  mime: string | null;
};

export function createProjectStateRepository(
  databaseClient: DatabaseClient,
): ProjectStateRepository {
  return {
    restoreProjectState: async ({
      projectId,
      actorUserId,
      restoredDocuments,
      checkpointSnapshot,
    }) =>
      databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);
        await assertActorCanWriteDocuments(tx, projectId, actorUserId);

        const currentDocuments = await tx.document.findMany({
          where: {
            projectId,
          },
          select: {
            id: true,
            path: true,
            kind: true,
            mime: true,
          },
          orderBy: {
            path: "asc",
          },
        });
        const currentDocumentsById = new Map(
          currentDocuments.map((document) => [document.id, document]),
        );
        const restoredDocumentIds = new Set(
          restoredDocuments.map((document) => document.documentId),
        );
        const deletedDocuments = currentDocuments.filter(
          (document) => !restoredDocumentIds.has(document.id),
        );
        const affectedTextDocumentIds = new Set<string>();

        for (const document of currentDocuments) {
          if (document.kind === "text") {
            affectedTextDocumentIds.add(document.id);
          }
        }

        for (const document of restoredDocuments) {
          if (document.kind === "text") {
            affectedTextDocumentIds.add(document.documentId);
          }
        }

        if (deletedDocuments.length > 0) {
          await tx.document.deleteMany({
            where: {
              id: {
                in: deletedDocuments.map((document) => document.id),
              },
            },
          });
        }

        const existingUpdates = restoredDocuments
          .map((document) => {
            const existingDocument = currentDocumentsById.get(
              document.documentId,
            );

            if (!existingDocument) {
              return null;
            }

            return {
              id: document.documentId,
              currentPath: existingDocument.path,
              nextPath: document.path,
              kind: document.kind,
              mime: document.mime,
            } satisfies ExistingDocumentUpdate;
          })
          .filter((document) => document !== null);

        const stagedUpdates = existingUpdates
          .filter((document) => document.currentPath !== document.nextPath)
          .map((document) => ({
            ...document,
            nextPath: createRestoreStagingPath(document.currentPath),
          }));

        for (const document of stagedUpdates) {
          await tx.document.update({
            where: {
              id: document.id,
            },
            data: {
              path: document.nextPath,
            },
          });
        }

        for (const document of existingUpdates) {
          await tx.document.update({
            where: {
              id: document.id,
            },
            data: {
              path: document.nextPath,
              kind: document.kind,
              mime: document.mime,
            },
          });
        }

        const createdDocuments = restoredDocuments.filter(
          (document) => !currentDocumentsById.has(document.documentId),
        );

        for (const document of createdDocuments) {
          await tx.document.create({
            data: {
              id: document.documentId,
              projectId,
              path: document.path,
              kind: document.kind,
              mime: document.mime,
            },
          });
        }

        const nonTextDocumentIds = restoredDocuments
          .filter((document) => document.kind !== "text")
          .map((document) => document.documentId);

        if (nonTextDocumentIds.length > 0) {
          await tx.documentTextState.deleteMany({
            where: {
              documentId: {
                in: nonTextDocumentIds,
              },
            },
          });
        }

        for (const document of restoredDocuments) {
          if (
            document.kind !== "text" ||
            document.textContent === null ||
            document.yjsState === null
          ) {
            continue;
          }

          const updated = await tx.documentTextState.updateMany({
            where: {
              documentId: document.documentId,
            },
            data: {
              yjsState: Buffer.from(document.yjsState),
              textContent: document.textContent,
              version: {
                increment: 1,
              },
            },
          });

          if (updated.count === 0) {
            await tx.documentTextState.create({
              data: {
                documentId: document.documentId,
                yjsState: Buffer.from(document.yjsState),
                textContent: document.textContent,
              },
            });
          }
        }

        const snapshot = await tx.snapshot.create({
          data: {
            projectId,
            storagePath: checkpointSnapshot.storagePath,
            message: checkpointSnapshot.message,
            authorId: checkpointSnapshot.authorId,
          },
        });

        return {
          snapshot,
          affectedTextDocumentIds: [...affectedTextDocumentIds],
        };
      }),
  };
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

function createRestoreStagingPath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("Expected restore staging path source to be absolute");
  }

  const stagingPath = path.slice(1);

  if (!stagingPath || stagingPath.startsWith("/")) {
    throw new Error("Expected restore staging path without leading slash");
  }

  return stagingPath;
}
