import * as Y from "yjs";

const TEXT_FIELD_NAME = "content";

export type CollaborationDocument = {
  applyUpdate: (update: Uint8Array) => void;
  exportState: () => Uint8Array;
  getText: () => string;
  destroy: () => void;
};

export type CollaborationService = {
  createTextDocument: (initialText: string) => CollaborationDocument;
  createEmptyTextDocument: () => CollaborationDocument;
};

export function createCollaborationService(): CollaborationService {
  return {
    createTextDocument: (initialText) => {
      const document = new Y.Doc();
      const text = document.getText(TEXT_FIELD_NAME);

      if (initialText.length > 0) {
        text.insert(0, initialText);
      }

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
