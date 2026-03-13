import * as Y from "yjs";

const TEXT_FIELD_NAME = "content";
const CANONICAL_SEED_CLIENT_ID = 1;

export type CollaborationDocument = {
  applyUpdate: (update: Uint8Array) => void;
  exportState: () => Uint8Array;
  getText: () => string;
  destroy: () => void;
};

export type CollaborationService = {
  createCanonicalTextState: (initialText: string) => Uint8Array;
  createDocumentFromState: (state: Uint8Array) => CollaborationDocument;
  createEmptyTextDocument: () => CollaborationDocument;
};

export function createCollaborationService(): CollaborationService {
  return {
    createCanonicalTextState: (initialText) => {
      const document = new Y.Doc();
      // Fixed temporary client IDs make repeated seed generation idempotent.
      document.clientID = CANONICAL_SEED_CLIENT_ID;
      const text = document.getText(TEXT_FIELD_NAME);

      try {
        if (initialText.length > 0) {
          text.insert(0, initialText);
        }

        return Y.encodeStateAsUpdate(document);
      } finally {
        document.destroy();
      }
    },
    createDocumentFromState: (state) => {
      const document = new Y.Doc();
      Y.applyUpdate(document, state);

      return createCollaborationDocument(document);
    },
    createEmptyTextDocument: () => createCollaborationDocument(new Y.Doc()),
  };
}

function createCollaborationDocument(document: Y.Doc): CollaborationDocument {
  return {
    applyUpdate: (update) => {
      Y.applyUpdate(document, update);
    },
    exportState: () => Y.encodeStateAsUpdate(document),
    getText: () => document.getText(TEXT_FIELD_NAME).toString(),
    destroy: () => {
      document.destroy();
    },
  };
}
