import { randomUUID } from "node:crypto";
import type { DocumentKind } from "@collab-tex/shared";
import type { StoredDocument } from "./document.js";

export type StoredSnapshot = {
  id: string;
  projectId: string;
  storagePath: string;
  message: string | null;
  authorId: string | null;
  createdAt: Date;
};

export type SnapshotDocumentState = {
  path: string;
  kind: DocumentKind;
  mime: string | null;
  content: string | null;
};

export type ProjectSnapshotState = {
  version: 1;
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
  findLatestForProject: (projectId: string) => Promise<StoredSnapshot | null>;
  createSnapshot: (input: {
    projectId: string;
    storagePath: string;
    message: string | null;
    authorId: string | null;
  }) => Promise<StoredSnapshot>;
};

export type CaptureProjectSnapshotInput = {
  projectId: string;
  authorId: string;
  documents: StoredDocument[];
};

export type SnapshotService = {
  loadDocumentContent: (document: StoredDocument) => Promise<string | null>;
  captureProjectSnapshot: (
    input: CaptureProjectSnapshotInput,
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

export function createSnapshotService({
  snapshotRepository,
  snapshotStore,
}: {
  snapshotRepository: SnapshotRepository;
  snapshotStore: SnapshotStore;
}): SnapshotService {
  return {
    loadDocumentContent: async (document) => {
      const snapshotState = await loadLatestUsableProjectSnapshotState(
        snapshotRepository,
        snapshotStore,
        document.projectId,
      );
      const snapshotDocument = snapshotState.documents[document.id];

      if (!snapshotDocument) {
        return getDefaultDocumentContent(document.kind);
      }

      if (document.kind === "binary") {
        return null;
      }

      return typeof snapshotDocument.content === "string"
        ? snapshotDocument.content
        : "";
    },
    captureProjectSnapshot: async ({ projectId, authorId, documents }) => {
      const previousState = await loadLatestUsableProjectSnapshotState(
        snapshotRepository,
        snapshotStore,
        projectId,
      );
      const nextState = buildProjectSnapshotState(documents, previousState);
      const storagePath = createSnapshotStoragePath(projectId);

      await snapshotStore.writeProjectSnapshot(storagePath, nextState);

      return snapshotRepository.createSnapshot({
        projectId,
        storagePath,
        message: null,
        authorId,
      });
    },
  };
}

export async function loadLatestUsableProjectSnapshotState(
  snapshotRepository: SnapshotRepository,
  snapshotStore: SnapshotStore,
  projectId: string,
): Promise<ProjectSnapshotState> {
  const latestSnapshot =
    await snapshotRepository.findLatestForProject(projectId);

  if (!latestSnapshot) {
    return createEmptyProjectSnapshotState();
  }

  try {
    return await snapshotStore.readProjectSnapshot(latestSnapshot.storagePath);
  } catch (error) {
    if (isRecoverableSnapshotReadError(error)) {
      return createEmptyProjectSnapshotState();
    }

    throw error;
  }
}

export function buildProjectSnapshotState(
  documents: StoredDocument[],
  previousState: ProjectSnapshotState,
): ProjectSnapshotState {
  const nextDocuments: Record<string, SnapshotDocumentState> = {};

  for (const document of documents) {
    const previousDocument = previousState.documents[document.id];
    const content =
      document.kind === "text"
        ? typeof previousDocument?.content === "string"
          ? previousDocument.content
          : ""
        : null;

    nextDocuments[document.id] = {
      path: document.path,
      kind: document.kind,
      mime: document.mime,
      content,
    };
  }

  return {
    version: 1,
    documents: nextDocuments,
  };
}

export function createEmptyProjectSnapshotState(): ProjectSnapshotState {
  return {
    version: 1,
    documents: {},
  };
}

export function parseProjectSnapshotState(
  value: unknown,
): ProjectSnapshotState {
  if (!isObject(value)) {
    throw new InvalidSnapshotDataError("snapshot payload must be an object");
  }

  if (value.version !== 1) {
    throw new InvalidSnapshotDataError("snapshot version must be 1");
  }

  if (!isObject(value.documents)) {
    throw new InvalidSnapshotDataError("snapshot documents must be an object");
  }

  const documents: Record<string, SnapshotDocumentState> = {};

  for (const [documentId, document] of Object.entries(value.documents)) {
    if (!isObject(document)) {
      throw new InvalidSnapshotDataError(
        "snapshot document entry must be an object",
      );
    }

    if (typeof document.path !== "string" || !document.path.trim()) {
      throw new InvalidSnapshotDataError("snapshot document path is required");
    }

    if (document.kind !== "text" && document.kind !== "binary") {
      throw new InvalidSnapshotDataError(
        "snapshot document kind must be text or binary",
      );
    }

    if (document.mime !== null && typeof document.mime !== "string") {
      throw new InvalidSnapshotDataError(
        "snapshot document mime must be a string or null",
      );
    }

    if (document.content !== null && typeof document.content !== "string") {
      throw new InvalidSnapshotDataError(
        "snapshot document content must be a string or null",
      );
    }

    documents[documentId] = {
      path: document.path,
      kind: document.kind,
      mime: document.mime,
      content: document.kind === "binary" ? null : (document.content ?? ""),
    };
  }

  return {
    version: 1,
    documents,
  };
}

function createSnapshotStoragePath(projectId: string): string {
  return `${projectId}/${Date.now()}-${randomUUID()}.json`;
}

function getDefaultDocumentContent(kind: DocumentKind): string | null {
  return kind === "text" ? "" : null;
}

function isRecoverableSnapshotReadError(error: unknown): boolean {
  return (
    error instanceof SnapshotDataNotFoundError ||
    error instanceof InvalidSnapshotDataError
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
