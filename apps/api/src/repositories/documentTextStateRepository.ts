import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { lockActiveProject } from "./projectRepositoryUtils.js";
import {
  DocumentTextStateAlreadyExistsError,
  DocumentTextStateDocumentNotFoundError,
  type DocumentTextStateRepository,
  type StoredDocumentTextState,
  UnsupportedCurrentTextStateDocumentError,
} from "../services/currentTextState.js";

export function createDocumentTextStateRepository(
  databaseClient: DatabaseClient,
): DocumentTextStateRepository {
  return {
    findByDocumentId: async (documentId) => {
      const row = await databaseClient.documentTextState.findFirst({
        where: {
          documentId,
          document: {
            kind: "text",
            project: {
              tombstoneAt: null,
            },
          },
        },
      });

      return row ? mapStoredDocumentTextState(row) : null;
    },
    create: async ({ documentId, yjsState, textContent }) =>
      databaseClient.$transaction(async (tx) => {
        const document = await getActiveTextDocument(tx, documentId);

        await lockActiveProject(tx, document.projectId);

        try {
          const row = await tx.documentTextState.create({
            data: {
              documentId,
              yjsState: Buffer.from(yjsState),
              textContent,
            },
          });

          return mapStoredDocumentTextState(row);
        } catch (error) {
          if (isPrismaKnownRequestLikeError(error)) {
            if (error.code === "P2002") {
              throw new DocumentTextStateAlreadyExistsError();
            }

            if (error.code === "P2003") {
              throw new DocumentTextStateDocumentNotFoundError();
            }
          }

          throw error;
        }
      }),
    update: async ({ documentId, yjsState, textContent, expectedVersion }) =>
      databaseClient.$transaction(async (tx) => {
        const document = await getActiveTextDocument(tx, documentId);

        await lockActiveProject(tx, document.projectId);

        const result = await tx.documentTextState.updateMany({
          where: {
            documentId,
            version: expectedVersion,
          },
          data: {
            yjsState: Buffer.from(yjsState),
            textContent,
            version: {
              increment: 1,
            },
          },
        });

        if (result.count === 0) {
          return null;
        }

        const row = await tx.documentTextState.findUnique({
          where: {
            documentId,
          },
        });

        if (!row) {
          throw new Error("Expected updated document text state to exist");
        }

        return mapStoredDocumentTextState(row);
      }),
  };
}

async function getActiveTextDocument(
  databaseClient: DatabaseClient | Prisma.TransactionClient,
  documentId: string,
): Promise<{ projectId: string }> {
  const document = await databaseClient.document.findUnique({
    where: {
      id: documentId,
    },
    select: {
      kind: true,
      projectId: true,
      project: {
        select: {
          tombstoneAt: true,
        },
      },
    },
  });

  if (!document || document.project.tombstoneAt !== null) {
    throw new DocumentTextStateDocumentNotFoundError();
  }

  if (document.kind !== "text") {
    throw new UnsupportedCurrentTextStateDocumentError();
  }

  return {
    projectId: document.projectId,
  };
}

function mapStoredDocumentTextState(
  row: Prisma.DocumentTextStateGetPayload<Record<string, never>>,
): StoredDocumentTextState {
  return {
    documentId: row.documentId,
    yjsState: new Uint8Array(row.yjsState),
    textContent: row.textContent,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isPrismaKnownRequestLikeError(
  error: unknown,
): error is Pick<Prisma.PrismaClientKnownRequestError, "code"> {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}
