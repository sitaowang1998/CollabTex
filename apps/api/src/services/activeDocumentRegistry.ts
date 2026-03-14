import type {
  CollaborationDocument,
  CollaborationService,
} from "./collaboration.js";

export type InitialDocumentState =
  | {
      kind: "empty";
    }
  | { kind: "yjs-update"; update: Uint8Array };

export type ActiveDocumentSession = {
  projectId: string;
  documentId: string;
  clientCount: number;
  document: CollaborationDocument;
};

export type ActiveDocumentSessionView = Readonly<{
  projectId: string;
  documentId: string;
  clientCount: number;
  document: CollaborationDocument;
}>;

export type ActiveDocumentSessionHandle = {
  session: ActiveDocumentSessionView;
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
  sessionView: ActiveDocumentSessionView;
  closePromise: Promise<void> | null;
  needsAnotherCloseCycle: boolean;
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

    const createdSession = createSessionRecord({
      projectId: input.projectId,
      documentId: input.documentId,
    })
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
      initialState.kind === "empty"
        ? collaborationService.createEmptyTextDocument()
        : collaborationService.createDocumentFromUpdate(initialState.update);
    const session: ActiveDocumentSession = {
      projectId: input.projectId,
      documentId: input.documentId,
      clientCount: 0,
      document,
    };

    return {
      session,
      sessionView: createSessionView(session),
      closePromise: null,
      needsAnotherCloseCycle: false,
    };
  }

  function createSessionHandle(input: {
    record: ActiveSessionRecord;
    sessionKey: string;
  }): ActiveDocumentSessionHandle {
    let isLeft = false;

    return {
      session: input.record.sessionView,
      leave: async () => {
        if (isLeft) {
          return;
        }

        isLeft = true;

        if (input.record.session.clientCount === 0) {
          return;
        }

        if (input.record.closePromise) {
          input.record.needsAnotherCloseCycle = true;
        }

        input.record.session.clientCount -= 1;

        if (input.record.session.clientCount > 0) {
          return;
        }

        await closeSessionWhenIdle(input.record, input.sessionKey);
      },
    };
  }

  async function closeSessionWhenIdle(
    record: ActiveSessionRecord,
    sessionKey: string,
  ) {
    let lastCloseError: unknown = null;

    while (
      record.session.clientCount === 0 &&
      activeSessions.get(sessionKey) === record
    ) {
      if (!record.closePromise) {
        record.needsAnotherCloseCycle = false;
        record.closePromise = runCloseCycle(record, sessionKey);
      }

      try {
        await record.closePromise;
        lastCloseError = null;
      } catch (error) {
        lastCloseError = error;
      }

      if (record.session.clientCount > 0) {
        return;
      }

      if (activeSessions.get(sessionKey) !== record) {
        if (lastCloseError) {
          throw lastCloseError;
        }

        return;
      }

      if (!record.needsAnotherCloseCycle) {
        if (lastCloseError) {
          throw lastCloseError;
        }

        return;
      }
    }
  }

  function runCloseCycle(record: ActiveSessionRecord, sessionKey: string) {
    return (async () => {
      try {
        await persistOnIdle({
          projectId: record.session.projectId,
          documentId: record.session.documentId,
          document: record.session.document,
        });
      } finally {
        record.closePromise = null;

        if (
          record.session.clientCount === 0 &&
          !record.needsAnotherCloseCycle
        ) {
          if (activeSessions.get(sessionKey) === record) {
            activeSessions.delete(sessionKey);
          }

          record.session.document.destroy();
        }
      }
    })();
  }
}

function createSessionKey(projectId: string, documentId: string) {
  return `${projectId}:${documentId}`;
}

function createSessionView(
  session: ActiveDocumentSession,
): ActiveDocumentSessionView {
  return Object.freeze({
    get projectId() {
      return session.projectId;
    },
    get documentId() {
      return session.documentId;
    },
    get clientCount() {
      return session.clientCount;
    },
    get document() {
      return session.document;
    },
  });
}
