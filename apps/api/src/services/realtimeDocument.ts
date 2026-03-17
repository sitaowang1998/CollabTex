import {
  ActiveDocumentSessionInvalidatedError,
  type ActiveDocumentSessionHandle,
} from "./activeDocumentRegistry.js";
import type { CollaborationService } from "./collaboration.js";
import {
  DocumentTextStateVersionConflictError,
  type CurrentTextStateService,
} from "./currentTextState.js";
import { DOCUMENT_WRITE_ROLES, type DocumentRepository } from "./document.js";
import type { ProjectAccessService } from "./projectAccess.js";

export type RealtimeDocumentUpdateResult = {
  serverVersion: number;
  acceptedUpdate: Uint8Array;
};

export type RealtimeDocumentService = {
  applyUpdate: (input: {
    projectId: string;
    documentId: string;
    userId: string;
    sessionHandle: Pick<ActiveDocumentSessionHandle, "runExclusive">;
    update: Uint8Array;
    isCurrentSession: () => boolean;
  }) => Promise<RealtimeDocumentUpdateResult>;
};

export class RealtimeDocumentSessionMismatchError extends Error {
  constructor() {
    super("Socket is not joined to the requested document");
  }
}

export class RealtimeDocumentNotFoundError extends Error {
  constructor() {
    super("Realtime document not found");
  }
}

export { ActiveDocumentSessionInvalidatedError };

export function createRealtimeDocumentService({
  collaborationService,
  projectAccessService,
  documentRepository,
  currentTextStateService,
}: {
  collaborationService: CollaborationService;
  projectAccessService: Pick<ProjectAccessService, "requireProjectRole">;
  documentRepository: Pick<DocumentRepository, "findById">;
  currentTextStateService: Pick<
    CurrentTextStateService,
    "loadOrHydrate" | "persist"
  >;
}): RealtimeDocumentService {
  return {
    applyUpdate: async ({
      projectId,
      documentId,
      userId,
      sessionHandle,
      update,
      isCurrentSession,
    }) =>
      sessionHandle.runExclusive(async (session) => {
        const baseState = session.document.exportUpdate();

        while (true) {
          if (session.isInvalidated) {
            throw new ActiveDocumentSessionInvalidatedError();
          }

          if (!isCurrentSession()) {
            throw new RealtimeDocumentSessionMismatchError();
          }

          await projectAccessService.requireProjectRole(
            projectId,
            userId,
            DOCUMENT_WRITE_ROLES,
          );

          const document = await documentRepository.findById(
            projectId,
            documentId,
          );

          if (!document || document.kind !== "text") {
            throw new RealtimeDocumentNotFoundError();
          }

          const workingDocument = collaborationService.createDocumentFromUpdate(
            session.document.exportUpdate(),
          );

          try {
            workingDocument.applyUpdate(update);

            const persisted = await currentTextStateService.persist({
              documentId,
              document: workingDocument,
              expectedVersion: session.serverVersion,
            });
            const acceptedState = persisted.yjsState;
            const acceptedUpdate = collaborationService.diffUpdates({
              fromUpdate: baseState,
              toUpdate: acceptedState,
            });

            replaceSessionDocument(session, workingDocument, persisted.version);

            return {
              serverVersion: persisted.version,
              acceptedUpdate,
            };
          } catch (error) {
            workingDocument.destroy();

            if (!(error instanceof DocumentTextStateVersionConflictError)) {
              throw error;
            }

            const reloadedState =
              await currentTextStateService.loadOrHydrate(document);
            const reloadedDocument =
              collaborationService.createDocumentFromUpdate(
                reloadedState.yjsState,
              );

            replaceSessionDocument(
              session,
              reloadedDocument,
              reloadedState.version,
            );
          }
        }
      }),
  };
}

function replaceSessionDocument(
  session: {
    document: {
      destroy: () => void;
    };
    serverVersion: number;
  },
  nextDocument: {
    destroy: () => void;
  },
  nextVersion: number,
) {
  const previousDocument = session.document;

  session.document = nextDocument;
  session.serverVersion = nextVersion;

  previousDocument.destroy();
}
