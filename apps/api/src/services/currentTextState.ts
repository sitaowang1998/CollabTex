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
    expectedVersion: number;
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
    super("Document not found");
  }
}

export class DocumentTextStateVersionConflictError extends Error {
  constructor() {
    super("Document text state version conflict");
  }
}

export class DocumentTextStateVersionRequiredError extends Error {
  constructor() {
    super("Document text state expected version is required");
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
      if (typeof expectedVersion !== "number") {
        throw new DocumentTextStateVersionRequiredError();
      }

      const updated = await documentTextStateRepository.update({
        documentId,
        yjsState: document.exportUpdate(),
        textContent: document.getText(),
        expectedVersion,
      });

      if (!updated) {
        throw new DocumentTextStateVersionConflictError();
      }

      return updated;
    },
  };
}

function assertTextDocument(document: StoredDocument) {
  if (document.kind !== "text") {
    throw new UnsupportedCurrentTextStateDocumentError();
  }
}
