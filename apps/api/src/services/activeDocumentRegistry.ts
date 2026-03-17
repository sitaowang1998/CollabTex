import type {
  CollaborationDocument,
  CollaborationService,
} from "./collaboration.js";

export type InitialDocumentState =
  | {
      kind: "empty";
      serverVersion: number;
    }
  | { kind: "yjs-update"; update: Uint8Array; serverVersion: number };

export type ActiveDocumentSession = {
  projectId: string;
  documentId: string;
  clientCount: number;
  document: CollaborationDocument;
  serverVersion: number;
  isInvalidated: boolean;
};

export type ActiveDocumentSessionView = Readonly<{
  projectId: string;
  documentId: string;
  clientCount: number;
  document: CollaborationDocument;
  serverVersion: number;
}>;

export type ActiveDocumentSessionHandle = {
  session: ActiveDocumentSessionView;
  runExclusive: <Result>(
    task: (session: ActiveDocumentSession) => Promise<Result>,
  ) => Promise<Result>;
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
  serverVersion: number;
}) => Promise<void>;

export type ActiveDocumentRegistry = {
  join: (input: {
    projectId: string;
    documentId: string;
  }) => Promise<ActiveDocumentSessionHandle>;
  invalidate: (input: { projectId: string; documentId: string }) => void;
};

export class ActiveDocumentSessionInvalidatedError extends Error {
  constructor() {
    super("Active document session is no longer current");
  }
}

type ActiveSessionRecord = {
  generation: number;
  session: ActiveDocumentSession;
  sessionView: ActiveDocumentSessionView;
  closePromise: Promise<void> | null;
  needsAnotherCloseCycle: boolean;
  pendingMutation: Promise<void>;
};

type PendingSessionRecord = {
  generation: number;
  promise: Promise<ActiveSessionRecord>;
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
  const pendingSessions = new Map<string, PendingSessionRecord>();
  const sessionGenerations = new Map<string, number>();

  return {
    join: async ({ projectId, documentId }) => {
      const sessionKey = createSessionKey(projectId, documentId);
      while (true) {
        const generation = getSessionGeneration(sessionKey);
        const record = await getOrCreateSession({
          sessionKey,
          projectId,
          documentId,
          generation,
        });

        if (
          record.generation !== generation ||
          record.session.isInvalidated ||
          getSessionGeneration(sessionKey) !== generation
        ) {
          continue;
        }

        record.session.clientCount += 1;

        return createSessionHandle({
          record,
          sessionKey,
        });
      }
    },
    invalidate: ({ projectId, documentId }) => {
      const sessionKey = createSessionKey(projectId, documentId);
      const nextGeneration = getSessionGeneration(sessionKey) + 1;
      const record = activeSessions.get(sessionKey);
      const pendingSession = pendingSessions.get(sessionKey);

      sessionGenerations.set(sessionKey, nextGeneration);

      if (record) {
        activeSessions.delete(sessionKey);
        record.session.isInvalidated = true;
      }

      if (pendingSession) {
        pendingSessions.delete(sessionKey);
      }
    },
  };

  function getSessionGeneration(sessionKey: string) {
    return sessionGenerations.get(sessionKey) ?? 0;
  }

  async function getOrCreateSession(input: {
    sessionKey: string;
    projectId: string;
    documentId: string;
    generation: number;
  }) {
    const existingSession = activeSessions.get(input.sessionKey);

    if (existingSession && existingSession.generation === input.generation) {
      return existingSession;
    }

    const pendingSession = pendingSessions.get(input.sessionKey);

    if (pendingSession && pendingSession.generation === input.generation) {
      return pendingSession.promise;
    }

    const createdSession = createSessionRecord({
      projectId: input.projectId,
      documentId: input.documentId,
      generation: input.generation,
    })
      .then((record) => {
        const pending = pendingSessions.get(input.sessionKey);

        if (
          getSessionGeneration(input.sessionKey) !== input.generation ||
          pending?.promise !== createdSession
        ) {
          record.session.isInvalidated = true;
          record.session.document.destroy();
          return record;
        }

        activeSessions.set(input.sessionKey, record);
        return record;
      })
      .finally(() => {
        const pending = pendingSessions.get(input.sessionKey);

        if (pending?.promise === createdSession) {
          pendingSessions.delete(input.sessionKey);
        }
      });

    pendingSessions.set(input.sessionKey, {
      generation: input.generation,
      promise: createdSession,
    });

    return createdSession;
  }

  async function createSessionRecord(input: {
    projectId: string;
    documentId: string;
    generation: number;
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
      serverVersion: initialState.serverVersion,
      isInvalidated: false,
    };

    return {
      generation: input.generation,
      session,
      sessionView: createSessionView(session),
      closePromise: null,
      needsAnotherCloseCycle: false,
      pendingMutation: Promise.resolve(),
    };
  }

  function createSessionHandle(input: {
    record: ActiveSessionRecord;
    sessionKey: string;
  }): ActiveDocumentSessionHandle {
    let isLeft = false;

    return {
      session: input.record.sessionView,
      runExclusive: async (task) => {
        const nextMutation = input.record.pendingMutation.then(() =>
          task(input.record.session),
        );

        input.record.pendingMutation = nextMutation.then(
          () => undefined,
          () => undefined,
        );

        return nextMutation;
      },
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
      (activeSessions.get(sessionKey) === record ||
        record.session.isInvalidated)
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
        await record.pendingMutation;
        if (!record.session.isInvalidated) {
          await persistOnIdle({
            projectId: record.session.projectId,
            documentId: record.session.documentId,
            document: record.session.document,
            serverVersion: record.session.serverVersion,
          });
        }
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
    get serverVersion() {
      return session.serverVersion;
    },
  });
}
