import type {
  CollaborationDocument,
  CollaborationService,
} from "./collaboration.js";

export type InitialDocumentState =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "yjs-update";
      update: Uint8Array;
    };

export type ActiveDocumentSession = {
  projectId: string;
  documentId: string;
  clientCount: number;
  document: CollaborationDocument;
};

export type ActiveDocumentSessionHandle = {
  session: ActiveDocumentSession;
  leave: () => Promise<void>;
};

export type InitialDocumentStateLoader = (input: {
  projectId: string;
  documentId: string;
}) => Promise<InitialDocumentState>;

export type ActiveDocumentIdlePersister = (input: {
  projectId: string;
  documentId: string;
  document: CollaborationDocument;
}) => Promise<void>;

export type ActiveDocumentRegistry = {
  join: (input: {
    projectId: string;
    documentId: string;
  }) => Promise<ActiveDocumentSessionHandle>;
};

type ActiveSessionRecord = {
  session: ActiveDocumentSession;
  closePromise: Promise<void> | null;
};

export function createActiveDocumentRegistry({
  collaborationService,
  loadInitialDocumentState,
  persistOnIdle,
}: {
  collaborationService: CollaborationService;
  loadInitialDocumentState: InitialDocumentStateLoader;
  persistOnIdle: ActiveDocumentIdlePersister;
}): ActiveDocumentRegistry {
  const activeSessions = new Map<string, ActiveSessionRecord>();
  const pendingSessions = new Map<string, Promise<ActiveSessionRecord>>();

  return {
    join: async ({ projectId, documentId }) => {
      const sessionKey = createSessionKey(projectId, documentId);
      const record = await getOrCreateSession({
        sessionKey,
        projectId,
        documentId,
      });

      record.session.clientCount += 1;

      return createSessionHandle({
        record,
        sessionKey,
      });
    },
  };

  async function getOrCreateSession(input: {
    sessionKey: string;
    projectId: string;
    documentId: string;
  }) {
    const existingSession = activeSessions.get(input.sessionKey);

    if (existingSession) {
      return existingSession;
    }

    const pendingSession = pendingSessions.get(input.sessionKey);

    if (pendingSession) {
      return pendingSession;
    }

    const createdSession = createSessionRecord(input)
      .then((record) => {
        activeSessions.set(input.sessionKey, record);
        return record;
      })
      .finally(() => {
        pendingSessions.delete(input.sessionKey);
      });

    pendingSessions.set(input.sessionKey, createdSession);

    return createdSession;
  }

  async function createSessionRecord(input: {
    projectId: string;
    documentId: string;
  }): Promise<ActiveSessionRecord> {
    const initialState = await loadInitialDocumentState({
      projectId: input.projectId,
      documentId: input.documentId,
    });
    const document =
      initialState.kind === "text"
        ? collaborationService.createTextDocument(initialState.text)
        : collaborationService.createDocumentFromUpdate(initialState.update);

    return {
      session: {
        projectId: input.projectId,
        documentId: input.documentId,
        clientCount: 0,
        document,
      },
      closePromise: null,
    };
  }

  function createSessionHandle(input: {
    record: ActiveSessionRecord;
    sessionKey: string;
  }): ActiveDocumentSessionHandle {
    let isLeft = false;

    return {
      session: input.record.session,
      leave: async () => {
        if (isLeft) {
          return;
        }

        isLeft = true;

        if (input.record.session.clientCount === 0) {
          return;
        }

        input.record.session.clientCount -= 1;

        if (input.record.session.clientCount > 0) {
          return;
        }

        if (!input.record.closePromise) {
          if (activeSessions.get(input.sessionKey) === input.record) {
            activeSessions.delete(input.sessionKey);
          }

          input.record.closePromise = (async () => {
            try {
              await persistOnIdle({
                projectId: input.record.session.projectId,
                documentId: input.record.session.documentId,
                document: input.record.session.document,
              });
            } finally {
              input.record.session.document.destroy();
            }
          })();
        }

        await input.record.closePromise;
      },
    };
  }
}

function createSessionKey(projectId: string, documentId: string) {
  return `${projectId}:${documentId}`;
}
