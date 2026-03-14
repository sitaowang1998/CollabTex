import * as Y from "yjs";

const TEXT_FIELD_NAME = "content";

export type CollaborationDocument = {
  applyUpdate: (update: Uint8Array) => void;
  exportUpdate: () => Uint8Array;
  getText: () => string;
  destroy: () => void;
};

export type CollaborationService = {
  createDocumentFromUpdate: (update: Uint8Array) => CollaborationDocument;
  createDocumentFromText: (text: string) => CollaborationDocument;
  createEmptyTextDocument: () => CollaborationDocument;
};

export class InvalidCollaborationUpdateError extends Error {
  constructor() {
    super("Collaboration update is invalid");
  }
}

export function createCollaborationService(): CollaborationService {
  return {
    createDocumentFromUpdate: (update) => {
      const document = new Y.Doc();

      try {
        applyCollaborationUpdate(document, update);
      } catch (error) {
        document.destroy();
        throw error;
      }

      return createCollaborationDocument(document);
    },
    createDocumentFromText: (text) => {
      const document = new Y.Doc();

      if (text.length > 0) {
        document.getText(TEXT_FIELD_NAME).insert(0, text);
      }

      return createCollaborationDocument(document);
    },
    createEmptyTextDocument: () => createCollaborationDocument(new Y.Doc()),
  };
}

function createCollaborationDocument(document: Y.Doc): CollaborationDocument {
  const text = document.getText(TEXT_FIELD_NAME);

  return {
    applyUpdate: (update) => {
      applyCollaborationUpdate(document, update);
    },
    exportUpdate: () => Y.encodeStateAsUpdate(document),
    getText: () => text.toString(),
    destroy: () => {
      document.destroy();
    },
  };
}

function applyCollaborationUpdate(document: Y.Doc, update: Uint8Array) {
  try {
    Y.applyUpdate(document, update);
  } catch {
    throw new InvalidCollaborationUpdateError();
  }
}
