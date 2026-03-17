import {
  type ActiveDocumentSession,
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

export type RealtimeDocumentUpdateResult<AcceptedContext = undefined> = {
  serverVersion: number;
  acceptedUpdate: Uint8Array;
  acceptedContext: AcceptedContext;
};

export type RealtimeDocumentUpdateInput<AcceptedContext = undefined> = {
  projectId: string;
  documentId: string;
  userId: string;
  sessionHandle: Pick<ActiveDocumentSessionHandle, "runExclusive">;
  update: Uint8Array;
  isCurrentSession: () => boolean;
  buildAcceptedContext?: (input: {
    session: Pick<ActiveDocumentSession, "isInvalidated">;
    isCurrentSession: boolean;
  }) => AcceptedContext | Promise<AcceptedContext>;
};

export type RealtimeDocumentService = {
  applyUpdate: <AcceptedContext = undefined>(
    input: RealtimeDocumentUpdateInput<AcceptedContext>,
  ) => Promise<RealtimeDocumentUpdateResult<AcceptedContext>>;
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
    applyUpdate: async <AcceptedContext = undefined>(
      input: RealtimeDocumentUpdateInput<AcceptedContext>,
    ) => {
      const {
        projectId,
        documentId,
        userId,
        sessionHandle,
        update,
        isCurrentSession,
        buildAcceptedContext,
      } = input;

      return sessionHandle.runExclusive(async (session) => {
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
            const acceptedContext = buildAcceptedContext
              ? await buildAcceptedContext({
                  session,
                  isCurrentSession: isCurrentSession(),
                })
              : (undefined as AcceptedContext);

            return {
              serverVersion: persisted.version,
              acceptedUpdate,
              acceptedContext,
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
      });
    },
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
