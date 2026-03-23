import { randomUUID } from "node:crypto";
import type { CollaborationService } from "./collaboration.js";
import type {
  CommentRepository,
  StoredCommentThreadWithComments,
} from "./comment.js";
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
import {
  BINARY_IO_BATCH_SIZE,
  allSettledInBatches,
  mapInBatches,
} from "./concurrency.js";

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

export type SnapshotCommentState = {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
};

export type SnapshotCommentThreadState = {
  id: string;
  documentId: string;
  status: "open" | "resolved";
  startAnchor: string;
  endAnchor: string;
  quotedText: string;
  createdAt: string;
  updatedAt: string;
  comments: SnapshotCommentState[];
};

export type ProjectSnapshotState = {
  documents: Record<string, SnapshotDocumentState>;
  commentThreads: SnapshotCommentThreadState[] | null;
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
  getProjectSnapshotContent: (input: {
    projectId: string;
    snapshotId: string;
  }) => Promise<{ snapshot: StoredSnapshot; state: ProjectSnapshotState }>;
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
  commentThreadLookup,
  getResetPublisher = () => noopResetPublisher,
}: {
  snapshotRepository: SnapshotRepository;
  snapshotStore: SnapshotStore;
  documentTextStateRepository: DocumentTextStateRepository;
  collaborationService: CollaborationService;
  projectStateRepository: ProjectStateRepository;
  binaryContentStore: Pick<BinaryContentStore, "get" | "put" | "delete">;
  documentLookup: Pick<DocumentRepository, "listForProject">;
  commentThreadLookup: Pick<CommentRepository, "listThreadsForProject">;
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
      const [previousState, allCommentThreads] = await Promise.all([
        loadLatestProjectSnapshotState(
          snapshotRepository,
          snapshotStore,
          projectId,
        ),
        commentThreadLookup.listThreadsForProject(projectId),
      ]);
      const capturedDocumentIds = new Set(
        documents.map((document) => document.id),
      );
      const commentThreads = allCommentThreads.filter((thread) =>
        capturedDocumentIds.has(thread.documentId),
      );
      const nextState = await buildProjectSnapshotState({
        projectId,
        documents,
        previousState,
        documentTextStateRepository,
        binaryContentStore,
        commentThreads,
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
    getProjectSnapshotContent: async ({ projectId, snapshotId }) => {
      const snapshot = await snapshotRepository.findById(projectId, snapshotId);

      if (!snapshot) {
        throw new SnapshotNotFoundError();
      }

      try {
        const state = await snapshotStore.readProjectSnapshot(
          snapshot.storagePath,
        );

        return { snapshot, state };
      } catch (error) {
        console.error(
          `Failed to read snapshot content: project=${projectId}, snapshot=${snapshotId}, path=${snapshot.storagePath}`,
          error,
        );
        throw error;
      }
    },
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
      const restoredCommentThreads = deserializeCommentThreads(
        targetState.commentThreads,
      );
      const checkpointStoragePath = createSnapshotStoragePath(projectId);

      await snapshotStore.writeProjectSnapshot(
        checkpointStoragePath,
        targetState,
      );

      const restoreResult = await projectStateRepository.restoreProjectState({
        projectId,
        actorUserId,
        restoredDocuments,
        restoredCommentThreads,
        checkpointSnapshot: {
          storagePath: checkpointStoragePath,
          message: `Restored from snapshot ${targetSnapshot.id}`,
          authorId: actorUserId,
        },
      });

      const syncResult = await syncBinaryContentStore({
        binaryContentStore,
        projectId,
        currentDocuments,
        restoredState: targetState,
      });

      if (syncResult.failedPutCount > 0) {
        console.error(
          `Snapshot restore for project ${projectId}: ${syncResult.failedPutCount} binary file(s) failed to write to the content store. The snapshot blob still contains the data; re-restoring may fix this.`,
        );
      }

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
  commentThreads,
}: {
  projectId: string;
  documents: StoredDocument[];
  previousState: ProjectSnapshotState;
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentIds"
  >;
  binaryContentStore: Pick<BinaryContentStore, "get">;
  commentThreads: StoredCommentThreadWithComments[];
}): Promise<ProjectSnapshotState> {
  const textDocuments = documents.filter((d) => d.kind === "text");
  const binaryDocuments = documents.filter((d) => d.kind === "binary");

  const [currentTextStates, binaryContentEntries] = await Promise.all([
    loadCurrentTextStateMap(textDocuments, documentTextStateRepository),
    mapInBatches(binaryDocuments, BINARY_IO_BATCH_SIZE, async (document) => {
      const base64 = await loadBinaryDocumentContent(
        binaryContentStore,
        projectId,
        document.id,
        previousState,
      );
      return [document.id, base64] as const;
    }),
  ]);

  const binaryContentMap = new Map(binaryContentEntries);
  const nextDocuments: Record<string, SnapshotDocumentState> = {};

  for (const document of textDocuments) {
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
  }

  for (const document of binaryDocuments) {
    nextDocuments[document.id] = {
      path: document.path,
      kind: "binary",
      mime: document.mime,
      binaryContentBase64: binaryContentMap.get(document.id) ?? "",
    } satisfies SnapshotBinaryDocumentState;
  }

  return {
    documents: nextDocuments,
    commentThreads: serializeCommentThreads(commentThreads),
  };
}

export function createEmptyProjectSnapshotState(): ProjectSnapshotState {
  return {
    documents: {},
    commentThreads: [],
  };
}

export function parseProjectSnapshotState(
  value: unknown,
): ProjectSnapshotState {
  if (!isObject(value)) {
    throw new InvalidSnapshotDataError("snapshot payload must be an object");
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

  const commentThreads = parseSnapshotCommentThreads(
    value.commentThreads,
    documents,
  );

  return {
    documents,
    commentThreads,
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
}): Promise<{ failedPutCount: number }> {
  const restoredBinaryDocuments = Object.entries(restoredState.documents)
    .filter(([, doc]) => doc.kind === "binary")
    .map(([id, doc]) => ({
      id,
      doc: doc as SnapshotBinaryDocumentState,
    }));

  const writableBinaryDocuments: typeof restoredBinaryDocuments = [];
  const emptyContentDocumentIds: string[] = [];

  for (const entry of restoredBinaryDocuments) {
    if (!entry.doc.binaryContentBase64) {
      console.warn(
        `Snapshot restore: skipping empty binary content for document ${entry.id} in project ${projectId}`,
      );
      emptyContentDocumentIds.push(entry.id);
    } else {
      writableBinaryDocuments.push(entry);
    }
  }

  const putResults = await allSettledInBatches(
    writableBinaryDocuments,
    BINARY_IO_BATCH_SIZE,
    ({ id, doc }) =>
      binaryContentStore.put(
        `${projectId}/${id}`,
        Buffer.from(doc.binaryContentBase64, "base64"),
      ),
  );

  let failedPutCount = 0;

  for (const result of putResults) {
    if (result.status === "rejected") {
      failedPutCount++;
      console.error(
        `Failed to write binary content during restore for project ${projectId}:`,
        result.reason,
      );
    }
  }

  const restoredDocumentIds = new Set(Object.keys(restoredState.documents));
  const removedBinaryDocuments = currentDocuments.filter(
    (document) =>
      document.kind === "binary" && !restoredDocumentIds.has(document.id),
  );

  const documentsToDelete = [
    ...removedBinaryDocuments.map((document) => document.id),
    ...emptyContentDocumentIds,
  ];

  const deleteResults = await allSettledInBatches(
    documentsToDelete,
    BINARY_IO_BATCH_SIZE,
    (documentId) => binaryContentStore.delete(`${projectId}/${documentId}`),
  );

  for (const result of deleteResults) {
    if (result.status === "rejected") {
      console.error(
        `Failed to delete binary content during restore for project ${projectId}:`,
        result.reason,
      );
    }
  }

  return { failedPutCount };
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

      console.warn(
        `Snapshot capture: binary document ${documentId} in project ${projectId} has no content in store or previous snapshot`,
      );
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

function serializeCommentThreads(
  threads: StoredCommentThreadWithComments[],
): SnapshotCommentThreadState[] {
  return threads.map((thread) => ({
    id: thread.id,
    documentId: thread.documentId,
    status: thread.status,
    startAnchor: thread.startAnchor,
    endAnchor: thread.endAnchor,
    quotedText: thread.quotedText,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      authorId: comment.authorId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    })),
  }));
}

export type RestoredCommentThread = {
  id: string;
  documentId: string;
  status: "open" | "resolved";
  startAnchor: string;
  endAnchor: string;
  quotedText: string;
  createdAt: Date;
  updatedAt: Date;
  comments: Array<{
    id: string;
    authorId: string | null;
    body: string;
    createdAt: Date;
  }>;
};

function deserializeCommentThreads(
  threads: SnapshotCommentThreadState[] | null,
): RestoredCommentThread[] | null {
  if (threads === null) {
    return null;
  }

  return threads.map((thread) => ({
    id: thread.id,
    documentId: thread.documentId,
    status: thread.status,
    startAnchor: thread.startAnchor,
    endAnchor: thread.endAnchor,
    quotedText: thread.quotedText,
    createdAt: new Date(thread.createdAt),
    updatedAt: new Date(thread.updatedAt),
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      authorId: comment.authorId,
      body: comment.body,
      createdAt: new Date(comment.createdAt),
    })),
  }));
}

function parseSnapshotCommentThreads(
  value: unknown,
  documents: Record<string, SnapshotDocumentState>,
): SnapshotCommentThreadState[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new InvalidSnapshotDataError(
      "snapshot commentThreads must be an array",
    );
  }

  const documentIds = new Set(Object.keys(documents));
  const seenThreadIds = new Set<string>();
  const seenCommentIds = new Set<string>();

  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}] must be an object`,
      );
    }

    if (typeof entry.id !== "string" || !UUID_PATTERN.test(entry.id)) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].id must be a valid UUID`,
      );
    }

    if (seenThreadIds.has(entry.id)) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].id is duplicated`,
      );
    }

    seenThreadIds.add(entry.id);

    if (
      typeof entry.documentId !== "string" ||
      !documentIds.has(entry.documentId)
    ) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].documentId must reference a document in the snapshot`,
      );
    }

    if (entry.status !== "open" && entry.status !== "resolved") {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].status must be "open" or "resolved"`,
      );
    }

    if (typeof entry.startAnchor !== "string") {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].startAnchor must be a string`,
      );
    }

    if (typeof entry.endAnchor !== "string") {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].endAnchor must be a string`,
      );
    }

    if (typeof entry.quotedText !== "string") {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].quotedText must be a string`,
      );
    }

    if (
      typeof entry.createdAt !== "string" ||
      !isValidIsoDateString(entry.createdAt)
    ) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].createdAt must be a valid ISO date string`,
      );
    }

    if (
      typeof entry.updatedAt !== "string" ||
      !isValidIsoDateString(entry.updatedAt)
    ) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].updatedAt must be a valid ISO date string`,
      );
    }

    if (!Array.isArray(entry.comments)) {
      throw new InvalidSnapshotDataError(
        `snapshot commentThreads[${index}].comments must be an array`,
      );
    }

    const comments = (entry.comments as unknown[]).map(
      (comment, commentIndex) => {
        if (!isObject(comment)) {
          throw new InvalidSnapshotDataError(
            `snapshot commentThreads[${index}].comments[${commentIndex}] must be an object`,
          );
        }

        if (typeof comment.id !== "string" || !UUID_PATTERN.test(comment.id)) {
          throw new InvalidSnapshotDataError(
            `snapshot commentThreads[${index}].comments[${commentIndex}].id must be a valid UUID`,
          );
        }

        if (seenCommentIds.has(comment.id)) {
          throw new InvalidSnapshotDataError(
            `snapshot commentThreads[${index}].comments[${commentIndex}].id is duplicated`,
          );
        }

        seenCommentIds.add(comment.id);

        if (
          comment.authorId !== null &&
          (typeof comment.authorId !== "string" ||
            !UUID_PATTERN.test(comment.authorId))
        ) {
          throw new InvalidSnapshotDataError(
            `snapshot commentThreads[${index}].comments[${commentIndex}].authorId must be a valid UUID or null`,
          );
        }

        if (typeof comment.body !== "string") {
          throw new InvalidSnapshotDataError(
            `snapshot commentThreads[${index}].comments[${commentIndex}].body must be a string`,
          );
        }

        if (
          typeof comment.createdAt !== "string" ||
          !isValidIsoDateString(comment.createdAt)
        ) {
          throw new InvalidSnapshotDataError(
            `snapshot commentThreads[${index}].comments[${commentIndex}].createdAt must be a valid ISO date string`,
          );
        }

        return {
          id: comment.id as string,
          authorId: comment.authorId as string | null,
          body: comment.body as string,
          createdAt: comment.createdAt as string,
        };
      },
    );

    return {
      id: entry.id as string,
      documentId: entry.documentId as string,
      status: entry.status as "open" | "resolved",
      startAnchor: entry.startAnchor as string,
      endAnchor: entry.endAnchor as string,
      quotedText: entry.quotedText as string,
      createdAt: entry.createdAt as string,
      updatedAt: entry.updatedAt as string,
      comments,
    };
  });
}

function isValidIsoDateString(value: string): boolean {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString() === value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
