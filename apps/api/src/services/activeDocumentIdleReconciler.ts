import type { ActiveDocumentIdlePersister } from "./activeDocumentRegistry.js";
import {
  DocumentTextStateDocumentNotFoundError,
  DocumentTextStateVersionConflictError,
  type CurrentTextStateService,
  type DocumentTextStateRepository,
} from "./currentTextState.js";

export function createActiveDocumentIdleReconciler({
  documentTextStateRepository,
  currentTextStateService,
}: {
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentId"
  >;
  currentTextStateService: Pick<CurrentTextStateService, "persist">;
}): ActiveDocumentIdlePersister {
  return async ({ documentId, document, serverVersion }) => {
    const persistedState =
      await documentTextStateRepository.findByDocumentId(documentId);

    if (!persistedState || persistedState.version !== serverVersion) {
      return;
    }

    const exportedState = document.exportUpdate();

    if (
      persistedState.textContent === document.getText() &&
      Buffer.from(persistedState.yjsState).equals(Buffer.from(exportedState))
    ) {
      return;
    }

    try {
      await currentTextStateService.persist({
        documentId,
        document,
        expectedVersion: serverVersion,
      });
    } catch (error) {
      if (
        error instanceof DocumentTextStateVersionConflictError ||
        error instanceof DocumentTextStateDocumentNotFoundError
      ) {
        return;
      }

      throw error;
    }
  };
}
