import * as Y from "yjs";

const TEXT_FIELD_NAME = "content";

export type CollaborationDocument = {
  applyUpdate: (update: Uint8Array) => void;
  exportState: () => Uint8Array;
  getText: () => string;
  destroy: () => void;
};

export type CollaborationService = {
  createDocumentFromState: (state: Uint8Array) => CollaborationDocument;
  createEmptyTextDocument: () => CollaborationDocument;
};

export function createCollaborationService(): CollaborationService {
  return {
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
