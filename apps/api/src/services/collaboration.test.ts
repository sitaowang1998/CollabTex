import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createCollaborationService,
  InvalidCollaborationUpdateError,
  type CollaborationDocument,
} from "./collaboration.js";

describe("collaboration service", () => {
  const openedDocuments: CollaborationDocument[] = [];

  afterEach(() => {
    for (const document of openedDocuments.splice(0)) {
      document.destroy();
    }
  });

  it("initializes a collaboration document from authoritative server state", () => {
    const service = createCollaborationService();
    const authoritativeUpdate = createAuthoritativeServerUpdate("Hello");
    const document = track(
      openedDocuments,
      service.createDocumentFromUpdate(authoritativeUpdate),
    );

    expect(document.getText()).toBe("Hello");
  });

  it("creates explicit empty text documents", () => {
    const service = createCollaborationService();
    const document = track(openedDocuments, service.createEmptyTextDocument());

    expect(document.getText()).toBe("");
  });

  it("does not change an empty document update when getText is called", () => {
    const service = createCollaborationService();
    const document = track(openedDocuments, service.createEmptyTextDocument());
    const beforeRead = document.exportUpdate();

    expect(document.getText()).toBe("");
    expect(document.exportUpdate()).toEqual(beforeRead);
  });

  it("hydrates an empty replica from authoritative server state without duplication", () => {
    const service = createCollaborationService();
    const authoritativeDocument = track(
      openedDocuments,
      service.createDocumentFromUpdate(
        createAuthoritativeServerUpdate("Hello"),
      ),
    );
    const replica = track(openedDocuments, service.createEmptyTextDocument());

    replica.applyUpdate(authoritativeDocument.exportUpdate());

    expect(replica.getText()).toBe("Hello");
  });

  it("reproduces the same update in another instance from exported state", () => {
    const service = createCollaborationService();
    const source = track(
      openedDocuments,
      service.createDocumentFromUpdate(
        createAuthoritativeServerUpdate("\\section{Intro}"),
      ),
    );
    const replica = track(openedDocuments, service.createEmptyTextDocument());

    replica.applyUpdate(source.exportUpdate());

    expect(replica.getText()).toBe("\\section{Intro}");
    expect(replica.exportUpdate()).toEqual(source.exportUpdate());
  });

  it("applies an incremental update from another synced instance", () => {
    const service = createCollaborationService();
    const source = track(
      openedDocuments,
      service.createDocumentFromUpdate(
        createAuthoritativeServerUpdate("Hello"),
      ),
    );
    const replica = track(openedDocuments, service.createEmptyTextDocument());
    replica.applyUpdate(source.exportUpdate());

    const sourceDoc = new Y.Doc();
    const replicaDoc = new Y.Doc();

    try {
      Y.applyUpdate(sourceDoc, source.exportUpdate());
      Y.applyUpdate(replicaDoc, replica.exportUpdate());

      sourceDoc.getText("content").insert(5, " world");
      const incrementalUpdate = Y.encodeStateAsUpdate(
        sourceDoc,
        Y.encodeStateVector(replicaDoc),
      );

      replica.applyUpdate(incrementalUpdate);

      expect(replica.getText()).toBe("Hello world");
    } finally {
      sourceDoc.destroy();
      replicaDoc.destroy();
    }
  });

  it("exports the full final state after multiple applied updates", () => {
    const service = createCollaborationService();
    const source = track(
      openedDocuments,
      service.createDocumentFromUpdate(createAuthoritativeServerUpdate("A")),
    );
    const replica = track(openedDocuments, service.createEmptyTextDocument());
    const reopened = track(openedDocuments, service.createEmptyTextDocument());
    const sourceDoc = new Y.Doc();

    try {
      Y.applyUpdate(sourceDoc, source.exportUpdate());
      replica.applyUpdate(source.exportUpdate());

      replica.applyUpdate(
        createIncrementalUpdate(
          sourceDoc,
          replica.exportUpdate(),
          (document) => {
            document.getText("content").insert(1, "B");
          },
        ),
      );
      replica.applyUpdate(
        createIncrementalUpdate(
          sourceDoc,
          replica.exportUpdate(),
          (document) => {
            document.getText("content").insert(2, "C");
          },
        ),
      );

      reopened.applyUpdate(replica.exportUpdate());

      expect(source.getText()).toBe("A");
      expect(replica.getText()).toBe("ABC");
      expect(reopened.getText()).toBe("ABC");
    } finally {
      sourceDoc.destroy();
    }
  });

  it("maps malformed creation updates to a domain error", () => {
    const service = createCollaborationService();

    expect(() =>
      service.createDocumentFromUpdate(Uint8Array.from([1, 2, 3])),
    ).toThrow(InvalidCollaborationUpdateError);
  });

  it("maps malformed applied updates to a domain error", () => {
    const service = createCollaborationService();
    const document = track(openedDocuments, service.createEmptyTextDocument());

    expect(() => document.applyUpdate(Uint8Array.from([1, 2, 3]))).toThrow(
      InvalidCollaborationUpdateError,
    );
  });
});

function createIncrementalUpdate(
  sourceDocument: Y.Doc,
  targetState: Uint8Array,
  mutate: (document: Y.Doc) => void,
) {
  const targetDocument = new Y.Doc();

  try {
    Y.applyUpdate(targetDocument, targetState);
    mutate(sourceDocument);

    return Y.encodeStateAsUpdate(
      sourceDocument,
      Y.encodeStateVector(targetDocument),
    );
  } finally {
    targetDocument.destroy();
  }
}

function createAuthoritativeServerUpdate(initialText: string) {
  const document = new Y.Doc();
  const text = document.getText("content");

  try {
    if (initialText.length > 0) {
      text.insert(0, initialText);
    }

    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

function track(
  openedDocuments: CollaborationDocument[],
  document: CollaborationDocument,
) {
  openedDocuments.push(document);
  return document;
}
