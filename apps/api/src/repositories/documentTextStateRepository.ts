import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
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
      const row = await databaseClient.documentTextState.findUnique({
        where: {
          documentId,
        },
      });

      return row ? mapStoredDocumentTextState(row) : null;
    },
    create: async ({ documentId, yjsState, textContent }) => {
      await assertTextDocument(databaseClient, documentId);

      try {
        const row = await databaseClient.documentTextState.create({
          data: {
            documentId,
            yjsState: Buffer.from(yjsState),
            textContent,
          },
        });

        return mapStoredDocumentTextState(row);
      } catch (error) {
        if (isPrismaKnownRequestLikeError(error) && error.code === "P2002") {
          throw new DocumentTextStateAlreadyExistsError();
        }

        throw error;
      }
    },
    update: async ({ documentId, yjsState, textContent, expectedVersion }) => {
      await assertTextDocument(databaseClient, documentId);

      const result = await databaseClient.documentTextState.updateMany({
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

      const row = await databaseClient.documentTextState.findUnique({
        where: {
          documentId,
        },
      });

      if (!row) {
        throw new Error("Expected updated document text state to exist");
      }

      return mapStoredDocumentTextState(row);
    },
  };
}

async function assertTextDocument(
  databaseClient: DatabaseClient,
  documentId: string,
): Promise<void> {
  const document = await databaseClient.document.findUnique({
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
