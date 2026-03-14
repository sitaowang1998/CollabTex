import type {
  CollaborationDocument,
  CollaborationService,
} from "./collaboration.js";
import type { StoredDocument } from "./document.js";
import type { SnapshotService } from "./snapshot.js";

export type StoredDocumentTextState = {
  documentId: string;
  yjsState: Uint8Array;
  textContent: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentTextStateRepository = {
  findByDocumentId: (
    documentId: string,
  ) => Promise<StoredDocumentTextState | null>;
  create: (input: {
    documentId: string;
    yjsState: Uint8Array;
    textContent: string;
  }) => Promise<StoredDocumentTextState>;
  update: (input: {
    documentId: string;
    yjsState: Uint8Array;
    textContent: string;
    expectedVersion: number;
  }) => Promise<StoredDocumentTextState | null>;
};

export type CurrentTextStateService = {
  loadOrHydrate: (document: StoredDocument) => Promise<StoredDocumentTextState>;
  persist: (input: {
    documentId: string;
    document: CollaborationDocument;
    expectedVersion?: number;
  }) => Promise<StoredDocumentTextState>;
};

export class UnsupportedCurrentTextStateDocumentError extends Error {
  constructor() {
    super("Current text state is only available for text documents");
  }
}

export class DocumentTextStateAlreadyExistsError extends Error {
  constructor() {
    super("Document text state already exists");
  }
}

export class DocumentTextStateDocumentNotFoundError extends Error {
  constructor() {
    super("Document text state document not found");
  }
}

export class DocumentTextStateVersionConflictError extends Error {
  constructor() {
    super("Document text state version conflict");
  }
}

export function createCurrentTextStateService({
  documentTextStateRepository,
  snapshotService,
  collaborationService,
}: {
  documentTextStateRepository: DocumentTextStateRepository;
  snapshotService: SnapshotService;
  collaborationService: CollaborationService;
}): CurrentTextStateService {
  return {
    loadOrHydrate: async (document) => {
      assertTextDocument(document);

      const existing = await documentTextStateRepository.findByDocumentId(
        document.id,
      );

      if (existing) {
        return existing;
      }

      const hydratedContent =
        await snapshotService.loadDocumentContent(document);
      const hydratedDocument = collaborationService.createDocumentFromText(
        typeof hydratedContent === "string" ? hydratedContent : "",
      );

      try {
        return await documentTextStateRepository.create({
          documentId: document.id,
          yjsState: hydratedDocument.exportUpdate(),
          textContent: hydratedDocument.getText(),
        });
      } catch (error) {
        if (!(error instanceof DocumentTextStateAlreadyExistsError)) {
          throw error;
        }

        const persisted = await documentTextStateRepository.findByDocumentId(
          document.id,
        );

        if (!persisted) {
          throw error;
        }

        return persisted;
      } finally {
        hydratedDocument.destroy();
      }
    },
    persist: async ({ documentId, document, expectedVersion }) => {
      const yjsState = document.exportUpdate();
      const textContent = document.getText();

      if (typeof expectedVersion === "number") {
        const updated = await documentTextStateRepository.update({
          documentId,
          yjsState,
          textContent,
          expectedVersion,
        });

        if (!updated) {
          throw new DocumentTextStateVersionConflictError();
        }

        return updated;
      }

      while (true) {
        const existing =
          await documentTextStateRepository.findByDocumentId(documentId);

        if (!existing) {
          try {
            return await documentTextStateRepository.create({
              documentId,
              yjsState,
              textContent,
            });
          } catch (error) {
            if (error instanceof DocumentTextStateAlreadyExistsError) {
              continue;
            }

            throw error;
          }
        }

        const updated = await documentTextStateRepository.update({
          documentId,
          yjsState,
          textContent,
          expectedVersion: existing.version,
        });

        if (updated) {
          return updated;
        }
      }
    },
  };
}

function assertTextDocument(document: StoredDocument) {
  if (document.kind !== "text") {
    throw new UnsupportedCurrentTextStateDocumentError();
  }
}
