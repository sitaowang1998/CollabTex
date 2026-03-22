import { Prisma } from "@prisma/client";
import type { DocumentKind } from "@collab-tex/shared";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { DOCUMENT_WRITE_ROLES } from "../services/document.js";
import type {
  StoredSnapshot,
  RestoredCommentThread,
} from "../services/snapshot.js";
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
    restoredCommentThreads: RestoredCommentThread[] | null;
    checkpointSnapshot: {
      storagePath: string;
      message: string | null;
      authorId: string | null;
    };
  }) => Promise<{
    snapshot: StoredSnapshot;
    affectedTextDocuments: Array<{
      documentId: string;
      serverVersion: number;
    }>;
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
      restoredCommentThreads,
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
        const affectedTextDocuments = new Map<string, number>();

        for (const document of currentDocuments) {
          if (document.kind === "text") {
            affectedTextDocuments.set(document.id, 0);
          }
        }

        for (const document of restoredDocuments) {
          if (document.kind === "text") {
            affectedTextDocuments.set(document.documentId, 0);
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

          const persistedState = await tx.documentTextState.upsert({
            where: {
              documentId: document.documentId,
            },
            update: {
              yjsState: Buffer.from(document.yjsState),
              textContent: document.textContent,
              version: {
                increment: 1,
              },
            },
            create: {
              documentId: document.documentId,
              yjsState: Buffer.from(document.yjsState),
              textContent: document.textContent,
            },
            select: {
              documentId: true,
              version: true,
            },
          });

          affectedTextDocuments.set(
            persistedState.documentId,
            persistedState.version,
          );
        }

        if (restoredCommentThreads !== null) {
          await tx.commentThread.deleteMany({
            where: { projectId },
          });
        }

        if (
          restoredCommentThreads !== null &&
          restoredCommentThreads.length > 0
        ) {
          const allAuthorIds = new Set<string>();

          for (const thread of restoredCommentThreads) {
            for (const comment of thread.comments) {
              if (comment.authorId !== null) {
                allAuthorIds.add(comment.authorId);
              }
            }
          }

          const existingUsers =
            allAuthorIds.size > 0
              ? await tx.user.findMany({
                  where: { id: { in: [...allAuthorIds] } },
                  select: { id: true },
                })
              : [];
          const existingUserIds = new Set(existingUsers.map((u) => u.id));

          await tx.commentThread.createMany({
            data: restoredCommentThreads.map((thread) => ({
              id: thread.id,
              projectId,
              documentId: thread.documentId,
              status: thread.status,
              startAnchor: thread.startAnchor,
              endAnchor: thread.endAnchor,
              quotedText: thread.quotedText,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
            })),
          });

          const nulledAuthorCount = restoredCommentThreads
            .flatMap((thread) => thread.comments)
            .filter(
              (comment) =>
                comment.authorId !== null &&
                !existingUserIds.has(comment.authorId),
            ).length;

          if (nulledAuthorCount > 0) {
            console.warn(
              `Snapshot restore for project ${projectId}: ${nulledAuthorCount} comment(s) had author(s) that no longer exist; restored with null authorId`,
            );
          }

          const allComments = restoredCommentThreads.flatMap((thread) =>
            thread.comments.map((comment) => ({
              id: comment.id,
              threadId: thread.id,
              authorId:
                comment.authorId !== null &&
                existingUserIds.has(comment.authorId)
                  ? comment.authorId
                  : null,
              body: comment.body,
              createdAt: comment.createdAt,
            })),
          );

          if (allComments.length > 0) {
            await tx.comment.createMany({
              data: allComments,
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
          affectedTextDocuments: [...affectedTextDocuments].map(
            ([documentId, serverVersion]) => ({
              documentId,
              serverVersion,
            }),
          ),
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
