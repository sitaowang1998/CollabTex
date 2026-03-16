import type { InitialDocumentStateLoader } from "./activeDocumentRegistry.js";
import type { CurrentTextStateService } from "./currentTextState.js";
import type { DocumentRepository } from "./document.js";

export class ActiveDocumentStateDocumentNotFoundError extends Error {
  constructor() {
    super("Active document state document not found");
  }
}

export function createActiveDocumentStateLoader({
  documentRepository,
  currentTextStateService,
}: {
  documentRepository: Pick<DocumentRepository, "findById">;
  currentTextStateService: Pick<CurrentTextStateService, "loadOrHydrate">;
}): InitialDocumentStateLoader {
  return async ({ projectId, documentId }) => {
    const document = await documentRepository.findById(projectId, documentId);

    if (!document) {
      throw new ActiveDocumentStateDocumentNotFoundError();
    }

    const state = await currentTextStateService.loadOrHydrate(document);

    return {
      kind: "yjs-update",
      update: state.yjsState,
    };
  };
}
