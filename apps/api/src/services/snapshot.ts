import { randomUUID } from "node:crypto";
import type { CollaborationService } from "./collaboration.js";
import {
  InvalidDocumentPathError,
  normalizeDocumentPath,
  type DocumentRepository,
  type StoredDocument,
} from "./document.js";
import type { DocumentTextStateRepository } from "./currentTextState.js";
import type { ProjectStateRepository } from "../repositories/projectStateRepository.js";
import {
  BinaryContentNotFoundError,
  type BinaryContentStore,
} from "./binaryContent.js";

export type StoredSnapshot = {
  id: string;
  projectId: string;
  storagePath: string;
  message: string | null;
  authorId: string | null;
  createdAt: Date;
};

export type SnapshotTextDocumentState = {
  path: string;
  kind: "text";
  mime: string | null;
  textContent: string;
};

export type SnapshotBinaryDocumentState = {
  path: string;
  kind: "binary";
  mime: string | null;
  binaryContentBase64: string;
};

export type SnapshotDocumentState =
  | SnapshotTextDocumentState
  | SnapshotBinaryDocumentState;

export type ProjectSnapshotState = {
  version: 2;
  documents: Record<string, SnapshotDocumentState>;
};

export type SnapshotStore = {
  readProjectSnapshot: (storagePath: string) => Promise<ProjectSnapshotState>;
  writeProjectSnapshot: (
    storagePath: string,
    snapshot: ProjectSnapshotState,
  ) => Promise<void>;
};

export type SnapshotRepository = {
  listForProject: (projectId: string) => Promise<StoredSnapshot[]>;
  findById: (
    projectId: string,
    snapshotId: string,
  ) => Promise<StoredSnapshot | null>;
  createSnapshot: (input: {
    projectId: string;
    storagePath: string;
    message: string | null;
    authorId: string | null;
  }) => Promise<StoredSnapshot>;
};

export type CaptureProjectSnapshotInput = {
  projectId: string;
  authorId: string | null;
  documents: StoredDocument[];
  message?: string | null;
};

export type RestoreProjectSnapshotInput = {
  projectId: string;
  snapshotId: string;
  actorUserId: string;
};

export type SnapshotResetPublisher = {
  emitDocumentReset: (input: {
    projectId: string;
    documentId: string;
    reason: string;
    serverVersion: number;
  }) => Promise<void> | void;
};

export type SnapshotService = {
  loadDocumentContent: (document: StoredDocument) => Promise<string | null>;
  captureProjectSnapshot: (
    input: CaptureProjectSnapshotInput,
  ) => Promise<StoredSnapshot>;
  listProjectSnapshots: (projectId: string) => Promise<StoredSnapshot[]>;
  restoreProjectSnapshot: (
    input: RestoreProjectSnapshotInput,
  ) => Promise<StoredSnapshot>;
};

export class InvalidSnapshotDataError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class SnapshotDataNotFoundError extends Error {
  constructor() {
    super("Snapshot data not found");
  }
}

export class SnapshotNotFoundError extends Error {
  constructor() {
    super("Snapshot not found");
  }
}

const noopResetPublisher: SnapshotResetPublisher = {
  emitDocumentReset: async () => {},
};

export function createSnapshotService({
  snapshotRepository,
  snapshotStore,
  documentTextStateRepository,
  collaborationService,
  projectStateRepository,
  binaryContentStore,
  documentLookup,
  getResetPublisher = () => noopResetPublisher,
}: {
  snapshotRepository: SnapshotRepository;
  snapshotStore: SnapshotStore;
  documentTextStateRepository: DocumentTextStateRepository;
  collaborationService: CollaborationService;
  projectStateRepository: ProjectStateRepository;
  binaryContentStore: Pick<BinaryContentStore, "get" | "put" | "delete">;
  documentLookup: Pick<DocumentRepository, "listForProject">;
  getResetPublisher?: () => SnapshotResetPublisher;
}): SnapshotService {
  return {
    loadDocumentContent: async (document) => {
      if (document.kind === "binary") {
        return null;
      }

      const currentState = await documentTextStateRepository.findByDocumentId(
        document.id,
      );

      if (currentState) {
        return currentState.textContent;
      }

      const snapshotState = await loadLatestProjectSnapshotState(
        snapshotRepository,
        snapshotStore,
        document.projectId,
      );
      const snapshotDocument = snapshotState.documents[document.id];

      if (!snapshotDocument || snapshotDocument.kind !== "text") {
        return "";
      }

      return snapshotDocument.textContent;
    },
    captureProjectSnapshot: async ({
      projectId,
      authorId,
      documents,
      message = null,
    }) => {
      const previousState = await loadLatestProjectSnapshotState(
        snapshotRepository,
        snapshotStore,
        projectId,
      );
      const nextState = await buildProjectSnapshotState({
        projectId,
        documents,
        previousState,
        documentTextStateRepository,
        binaryContentStore,
      });
      const storagePath = createSnapshotStoragePath(projectId);

      await snapshotStore.writeProjectSnapshot(storagePath, nextState);

      return snapshotRepository.createSnapshot({
        projectId,
        storagePath,
        message,
        authorId,
      });
    },
    listProjectSnapshots: async (projectId) =>
      snapshotRepository.listForProject(projectId),
    restoreProjectSnapshot: async ({ projectId, snapshotId, actorUserId }) => {
      const targetSnapshot = await snapshotRepository.findById(
        projectId,
        snapshotId,
      );

      if (!targetSnapshot) {
        throw new SnapshotNotFoundError();
      }

      const [targetState, currentDocuments] = await Promise.all([
        snapshotStore.readProjectSnapshot(targetSnapshot.storagePath),
        documentLookup.listForProject(projectId),
      ]);
      const restoredDocuments = buildRestoredProjectDocumentStates({
        snapshotState: targetState,
        collaborationService,
      });
      const checkpointStoragePath = createSnapshotStoragePath(projectId);

      await snapshotStore.writeProjectSnapshot(
        checkpointStoragePath,
        targetState,
      );

      const restoreResult = await projectStateRepository.restoreProjectState({
        projectId,
        actorUserId,
        restoredDocuments,
        checkpointSnapshot: {
          storagePath: checkpointStoragePath,
          message: `Restored from snapshot ${targetSnapshot.id}`,
          authorId: actorUserId,
        },
      });

      await syncBinaryContentStore({
        binaryContentStore,
        projectId,
        currentDocuments,
        restoredState: targetState,
      });

      const resetPublisher = getResetPublisher();

      await Promise.all(
        restoreResult.affectedTextDocuments.map(
          ({ documentId, serverVersion }) =>
            resetPublisher.emitDocumentReset({
              projectId,
              documentId,
              reason: "snapshot_restore",
              serverVersion,
            }),
        ),
      );

      return restoreResult.snapshot;
    },
  };
}

export async function loadLatestProjectSnapshotState(
  snapshotRepository: Pick<SnapshotRepository, "listForProject">,
  snapshotStore: Pick<SnapshotStore, "readProjectSnapshot">,
  projectId: string,
): Promise<ProjectSnapshotState> {
  const snapshots = await snapshotRepository.listForProject(projectId);

  for (const snapshot of snapshots) {
    try {
      return await snapshotStore.readProjectSnapshot(snapshot.storagePath);
    } catch (error) {
      if (isRecoverableSnapshotReadError(error)) {
        continue;
      }

      throw error;
    }
  }

  return createEmptyProjectSnapshotState();
}

export async function buildProjectSnapshotState({
  projectId,
  documents,
  previousState,
  documentTextStateRepository,
  binaryContentStore,
}: {
  projectId: string;
  documents: StoredDocument[];
  previousState: ProjectSnapshotState;
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentIds"
  >;
  binaryContentStore: Pick<BinaryContentStore, "get">;
}): Promise<ProjectSnapshotState> {
  const currentTextStates = await loadCurrentTextStateMap(
    documents,
    documentTextStateRepository,
  );
  const nextDocuments: Record<string, SnapshotDocumentState> = {};

  for (const document of documents) {
    if (document.kind === "text") {
      nextDocuments[document.id] = {
        path: document.path,
        kind: "text",
        mime: document.mime,
        textContent: loadTextDocumentContent({
          documentId: document.id,
          previousState,
          currentTextStates,
        }),
      } satisfies SnapshotTextDocumentState;
    } else {
      nextDocuments[document.id] = {
        path: document.path,
        kind: "binary",
        mime: document.mime,
        binaryContentBase64: await loadBinaryDocumentContent(
          binaryContentStore,
          projectId,
          document.id,
          previousState,
        ),
      } satisfies SnapshotBinaryDocumentState;
    }
  }

  return {
    version: 2,
    documents: nextDocuments,
  };
}

export function createEmptyProjectSnapshotState(): ProjectSnapshotState {
  return {
    version: 2,
    documents: {},
  };
}

export function parseProjectSnapshotState(
  value: unknown,
): ProjectSnapshotState {
  if (!isObject(value)) {
    throw new InvalidSnapshotDataError("snapshot payload must be an object");
  }

  if (value.version !== 2) {
    throw new InvalidSnapshotDataError(
      "snapshot payload uses an unsupported format",
    );
  }

  if (!isObject(value.documents)) {
    throw new InvalidSnapshotDataError("snapshot documents must be an object");
  }

  const documents: Record<string, SnapshotDocumentState> = {};
  const seenPaths = new Set<string>();

  for (const [documentId, document] of Object.entries(value.documents)) {
    assertSnapshotDocumentId(documentId);

    if (!isObject(document)) {
      throw new InvalidSnapshotDataError(
        "snapshot document entry must be an object",
      );
    }

    const path = parseSnapshotDocumentPath(document.path);

    if (seenPaths.has(path)) {
      throw new InvalidSnapshotDataError(
        "snapshot document paths must be unique",
      );
    }

    seenPaths.add(path);

    const mime = parseSnapshotDocumentMime(document.mime);

    if (document.kind === "text") {
      if (typeof document.textContent !== "string") {
        throw new InvalidSnapshotDataError(
          "text snapshot documents must include textContent",
        );
      }

      documents[documentId] = {
        path,
        kind: "text",
        mime,
        textContent: document.textContent,
      };
      continue;
    }

    if (document.kind === "binary") {
      if (typeof document.binaryContentBase64 !== "string") {
        throw new InvalidSnapshotDataError(
          "binary snapshot documents must include binaryContentBase64",
        );
      }

      documents[documentId] = {
        path,
        kind: "binary",
        mime,
        binaryContentBase64: document.binaryContentBase64,
      };
      continue;
    }

    throw new InvalidSnapshotDataError(
      "snapshot document kind must be text or binary",
    );
  }

  assertSnapshotPathsDoNotConflict(Object.values(documents));

  return {
    version: 2,
    documents,
  };
}

export function createSnapshotStoragePath(projectId: string): string {
  return `${projectId}/${Date.now()}-${randomUUID()}.json`;
}

function buildRestoredProjectDocumentStates({
  snapshotState,
  collaborationService,
}: {
  snapshotState: ProjectSnapshotState;
  collaborationService: CollaborationService;
}) {
  return Object.entries(snapshotState.documents).map(
    ([documentId, snapshotDocument]) => {
      if (snapshotDocument.kind === "binary") {
        return {
          documentId,
          path: snapshotDocument.path,
          kind: "binary" as const,
          mime: snapshotDocument.mime,
          textContent: null,
          yjsState: null,
        };
      }

      const document = collaborationService.createDocumentFromText(
        snapshotDocument.textContent,
      );

      try {
        return {
          documentId,
          path: snapshotDocument.path,
          kind: "text" as const,
          mime: snapshotDocument.mime,
          textContent: snapshotDocument.textContent,
          yjsState: document.exportUpdate(),
        };
      } finally {
        document.destroy();
      }
    },
  );
}

async function syncBinaryContentStore({
  binaryContentStore,
  projectId,
  currentDocuments,
  restoredState,
}: {
  binaryContentStore: Pick<BinaryContentStore, "put" | "delete">;
  projectId: string;
  currentDocuments: StoredDocument[];
  restoredState: ProjectSnapshotState;
}): Promise<void> {
  const restoredDocumentIds = new Set(Object.keys(restoredState.documents));

  const removedBinaryDocuments = currentDocuments.filter(
    (document) =>
      document.kind === "binary" && !restoredDocumentIds.has(document.id),
  );

  await Promise.all(
    removedBinaryDocuments.map((document) =>
      binaryContentStore.delete(`${projectId}/${document.id}`),
    ),
  );

  const restoredBinaryDocuments = Object.entries(restoredState.documents)
    .filter(([, doc]) => doc.kind === "binary")
    .map(([id, doc]) => ({
      id,
      doc: doc as SnapshotBinaryDocumentState,
    }));

  await Promise.all(
    restoredBinaryDocuments.map(({ id, doc }) =>
      binaryContentStore.put(
        `${projectId}/${id}`,
        Buffer.from(doc.binaryContentBase64, "base64"),
      ),
    ),
  );
}

async function loadCurrentTextStateMap(
  documents: StoredDocument[],
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentIds"
  >,
): Promise<Map<string, string>> {
  const textDocumentIds = documents
    .filter((document) => document.kind === "text")
    .map((document) => document.id);

  const currentStates =
    await documentTextStateRepository.findByDocumentIds(textDocumentIds);

  return new Map(
    currentStates.map((currentState) => [
      currentState.documentId,
      currentState.textContent,
    ]),
  );
}

function loadTextDocumentContent({
  documentId,
  previousState,
  currentTextStates,
}: {
  documentId: string;
  previousState: ProjectSnapshotState;
  currentTextStates: ReadonlyMap<string, string>;
}): string {
  const currentTextContent = currentTextStates.get(documentId);

  if (typeof currentTextContent === "string") {
    return currentTextContent;
  }

  return loadTextDocumentFallback(previousState, documentId);
}

function loadTextDocumentFallback(
  previousState: ProjectSnapshotState,
  documentId: string,
): string {
  const snapshotDocument = previousState.documents[documentId];

  if (!snapshotDocument || snapshotDocument.kind !== "text") {
    return "";
  }

  return snapshotDocument.textContent;
}

async function loadBinaryDocumentContent(
  binaryContentStore: Pick<BinaryContentStore, "get">,
  projectId: string,
  documentId: string,
  previousState: ProjectSnapshotState,
): Promise<string> {
  const storagePath = `${projectId}/${documentId}`;

  try {
    const buffer = await binaryContentStore.get(storagePath);
    return buffer.toString("base64");
  } catch (error) {
    if (error instanceof BinaryContentNotFoundError) {
      const snapshotDocument = previousState.documents[documentId];

      if (snapshotDocument && snapshotDocument.kind === "binary") {
        return snapshotDocument.binaryContentBase64;
      }

      return "";
    }

    throw error;
  }
}

function parseSnapshotDocumentPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidSnapshotDataError("snapshot document path is required");
  }

  try {
    const normalizedPath = normalizeDocumentPath(value);

    if (value !== normalizedPath) {
      throw new InvalidSnapshotDataError(
        "snapshot document path must be a canonical absolute path",
      );
    }

    return normalizedPath;
  } catch (error) {
    if (error instanceof InvalidDocumentPathError) {
      throw new InvalidSnapshotDataError(
        `snapshot document path is invalid: ${error.message}`,
      );
    }

    throw error;
  }
}

function parseSnapshotDocumentMime(value: unknown): string | null {
  if (value !== null && typeof value !== "string") {
    throw new InvalidSnapshotDataError(
      "snapshot document mime must be a string or null",
    );
  }

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecoverableSnapshotReadError(error: unknown): boolean {
  return (
    error instanceof SnapshotDataNotFoundError ||
    error instanceof InvalidSnapshotDataError
  );
}

function assertSnapshotDocumentId(documentId: string) {
  if (!UUID_PATTERN.test(documentId)) {
    throw new InvalidSnapshotDataError(
      "snapshot document id must be a valid UUID",
    );
  }
}

function assertSnapshotPathsDoNotConflict(
  documents: SnapshotDocumentState[],
): void {
  const sortedPaths = documents
    .map((document) => document.path)
    .sort((left, right) => left.localeCompare(right));

  for (let index = 0; index < sortedPaths.length - 1; index += 1) {
    const currentPath = sortedPaths[index];
    const nextPath = sortedPaths[index + 1];

    if (nextPath.startsWith(`${currentPath}/`)) {
      throw new InvalidSnapshotDataError(
        "snapshot document paths must not contain file/descendant conflicts",
      );
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
