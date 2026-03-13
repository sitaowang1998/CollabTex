import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createCollaborationService,
  type CollaborationDocument,
} from "./collaboration.js";

describe("collaboration service", () => {
  const openedDocuments: CollaborationDocument[] = [];

  afterEach(() => {
    for (const document of openedDocuments.splice(0)) {
      document.destroy();
    }
  });

  it("initializes a collaboration document from canonical text state", () => {
    const service = createCollaborationService();
    const document = track(
      openedDocuments,
      service.createDocumentFromState(
        service.createCanonicalTextState("Hello"),
      ),
    );

    expect(document.getText()).toBe("Hello");
  });

  it("creates explicit empty text documents", () => {
    const service = createCollaborationService();
    const document = track(openedDocuments, service.createEmptyTextDocument());

    expect(document.getText()).toBe("");
  });

  it("generates stable canonical state for repeated text seeding", () => {
    const service = createCollaborationService();
    const seedStateA = service.createCanonicalTextState("Hello");
    const seedStateB = service.createCanonicalTextState("Hello");
    const firstReplica = track(
      openedDocuments,
      service.createDocumentFromState(seedStateA),
    );
    const secondReplica = track(
      openedDocuments,
      service.createDocumentFromState(seedStateB),
    );

    firstReplica.applyUpdate(secondReplica.exportState());

    expect(seedStateB).toEqual(seedStateA);
    expect(firstReplica.getText()).toBe("Hello");
  });

  it("reproduces the same state in another instance from exported state", () => {
    const service = createCollaborationService();
    const source = track(
      openedDocuments,
      service.createDocumentFromState(
        service.createCanonicalTextState("\\section{Intro}"),
      ),
    );
    const replica = track(openedDocuments, service.createEmptyTextDocument());

    replica.applyUpdate(source.exportState());

    expect(replica.getText()).toBe("\\section{Intro}");
    expect(replica.exportState()).toEqual(source.exportState());
  });

  it("applies an incremental update from another synced instance", () => {
    const service = createCollaborationService();
    const source = track(
      openedDocuments,
      service.createDocumentFromState(
        service.createCanonicalTextState("Hello"),
      ),
    );
    const replica = track(
      openedDocuments,
      service.createDocumentFromState(
        service.createCanonicalTextState("Hello"),
      ),
    );

    const sourceDoc = new Y.Doc();
    const replicaDoc = new Y.Doc();

    try {
      Y.applyUpdate(sourceDoc, source.exportState());
      Y.applyUpdate(replicaDoc, replica.exportState());

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
    const seedState = service.createCanonicalTextState("A");
    const source = track(
      openedDocuments,
      service.createDocumentFromState(seedState),
    );
    const replica = track(
      openedDocuments,
      service.createDocumentFromState(seedState),
    );
    const reopened = track(openedDocuments, service.createEmptyTextDocument());
    const sourceDoc = new Y.Doc();

    try {
      Y.applyUpdate(sourceDoc, source.exportState());

      replica.applyUpdate(
        createIncrementalUpdate(
          sourceDoc,
          replica.exportState(),
          (document) => {
            document.getText("content").insert(1, "B");
          },
        ),
      );
      replica.applyUpdate(
        createIncrementalUpdate(
          sourceDoc,
          replica.exportState(),
          (document) => {
            document.getText("content").insert(2, "C");
          },
        ),
      );

      reopened.applyUpdate(replica.exportState());

      expect(source.getText()).toBe("A");
      expect(replica.getText()).toBe("ABC");
      expect(reopened.getText()).toBe("ABC");
    } finally {
      sourceDoc.destroy();
    }
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

function track(
  openedDocuments: CollaborationDocument[],
  document: CollaborationDocument,
) {
  openedDocuments.push(document);
  return document;
}
