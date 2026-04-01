import { describe, expect, it, vi } from "vitest";
import type {
  CurrentTextStateService,
  StoredDocumentTextState,
} from "./currentTextState.js";
import { UnsupportedCurrentTextStateDocumentError } from "./currentTextState.js";
import type { DocumentRepository, StoredDocument } from "./document.js";
import {
  ActiveDocumentStateDocumentNotFoundError,
  createActiveDocumentStateLoader,
} from "./activeDocumentStateLoader.js";

describe("active document state loader", () => {
  it("hydrates active sessions from persisted current yjs state", async () => {
    const documentRepository = createDocumentRepository();
    const currentTextStateService = createCurrentTextStateService();
    const loader = createActiveDocumentStateLoader({
      documentRepository,
      currentTextStateService,
    });
    const document = createStoredDocument();
    const storedState = createStoredDocumentTextState({
      yjsState: Uint8Array.from([1, 2, 3]),
    });

    documentRepository.findById.mockResolvedValue(document);
    currentTextStateService.loadOrHydrate.mockResolvedValue(storedState);

    await expect(
      loader({
        projectId: "project-1",
        documentId: "document-1",
      }),
    ).resolves.toEqual({
      kind: "yjs-update",
      update: Uint8Array.from([1, 2, 3]),
      serverVersion: 1,
    });
    expect(currentTextStateService.loadOrHydrate).toHaveBeenCalledWith(
      document,
    );
  });

  it("fails clearly when the requested document is missing", async () => {
    const loader = createActiveDocumentStateLoader({
      documentRepository: createDocumentRepository(),
      currentTextStateService: createCurrentTextStateService(),
    });

    await expect(
      loader({
        projectId: "project-1",
        documentId: "missing-document",
      }),
    ).rejects.toBeInstanceOf(ActiveDocumentStateDocumentNotFoundError);
  });

  it("rejects binary documents through current text state validation", async () => {
    const documentRepository = createDocumentRepository();
    const currentTextStateService = createCurrentTextStateService();
    const loader = createActiveDocumentStateLoader({
      documentRepository,
      currentTextStateService,
    });

    documentRepository.findById.mockResolvedValue(
      createStoredDocument({
        id: "binary-1",
        path: "/figure.png",
        kind: "binary",
        mime: "image/png",
      }),
    );
    currentTextStateService.loadOrHydrate.mockRejectedValue(
      new UnsupportedCurrentTextStateDocumentError(),
    );

    await expect(
      loader({
        projectId: "project-1",
        documentId: "binary-1",
      }),
    ).rejects.toBeInstanceOf(UnsupportedCurrentTextStateDocumentError);
  });
});

function createDocumentRepository() {
  return {
    findById: vi.fn<DocumentRepository["findById"]>(),
  };
}

function createCurrentTextStateService() {
  return {
    loadOrHydrate: vi.fn<CurrentTextStateService["loadOrHydrate"]>(),
  };
}

function createStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text",
    mime: null,
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createStoredDocumentTextState(
  overrides: Partial<StoredDocumentTextState> = {},
): StoredDocumentTextState {
  return {
    documentId: "document-1",
    yjsState: Uint8Array.from([]),
    textContent: "\\section{Draft}",
    version: 1,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
