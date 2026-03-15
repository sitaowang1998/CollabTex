import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { isPrismaKnownRequestLikeError } from "./projectRepositoryUtils.js";
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
        await lockActiveProjectForDocument(tx, documentId);
        await assertActiveTextDocument(tx, documentId);

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
        await lockActiveProjectForDocument(tx, documentId);
        await assertActiveTextDocument(tx, documentId);

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
          const existingRow = await tx.documentTextState.findUnique({
            where: {
              documentId,
            },
          });

          if (!existingRow) {
            throw new DocumentTextStateDocumentNotFoundError();
          }

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

async function lockActiveProjectForDocument(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ projectId: string }>>(Prisma.sql`
    SELECT p.id AS "projectId"
    FROM "Document" d
    INNER JOIN "Project" p
      ON p.id = d."projectId"
    WHERE d.id = CAST(${documentId} AS uuid)
      AND p."tombstoneAt" IS NULL
    FOR UPDATE OF p
  `);

  if (rows.length === 0) {
    throw new DocumentTextStateDocumentNotFoundError();
  }
}

async function assertActiveTextDocument(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  const document = await tx.document.findUnique({
    where: {
      id: documentId,
    },
    select: {
      kind: true,
    },
  });

  if (!document) {
    throw new DocumentTextStateDocumentNotFoundError();
  }

  if (document.kind !== "text") {
    throw new UnsupportedCurrentTextStateDocumentError();
  }
}

function mapStoredDocumentTextState(
  row: Prisma.DocumentTextStateGetPayload<Record<string, never>>,
): StoredDocumentTextState {
  return {
    documentId: row.documentId,
    yjsState: row.yjsState,
    textContent: row.textContent,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
