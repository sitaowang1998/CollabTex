import type {
  CreateFileRequest,
  DocumentKind,
  FileTreeNode,
  ProjectDocument,
  ProjectDocumentContentResponse,
} from "@collab-tex/shared";
import type { BinaryContentStore } from "./binaryContent.js";
import { BINARY_IO_BATCH_SIZE, allSettledInBatches } from "./concurrency.js";
import { type ProjectAccessService } from "./projectAccess.js";
import type { SnapshotService } from "./snapshot.js";
import type { SnapshotRefreshTrigger } from "./snapshotRefresh.js";

const DOCUMENT_PATH_MAX_LENGTH = 1024;
const DOCUMENT_NODE_NAME_MAX_LENGTH = DOCUMENT_PATH_MAX_LENGTH - 1;
const DOCUMENT_MIME_MAX_LENGTH = 255;
export const DOCUMENT_WRITE_ROLES = ["admin", "editor"] as const;

export type StoredDocument = {
  id: string;
  projectId: string;
  path: string;
  kind: DocumentKind;
  mime: string | null;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateFileInput = {
  projectId: string;
  actorUserId: string;
} & CreateFileRequest;

export type MoveNodeInput = {
  projectId: string;
  actorUserId: string;
  path: string;
  destinationParentPath: string | null;
};

export type RenameNodeInput = {
  projectId: string;
  actorUserId: string;
  path: string;
  name: string;
};

export type DeleteNodeInput = {
  projectId: string;
  actorUserId: string;
  path: string;
};

export type GetDocumentContentInput = {
  projectId: string;
  userId: string;
  path: string;
};

export type DocumentRepository = {
  listForProject: (projectId: string) => Promise<StoredDocument[]>;
  findById: (
    projectId: string,
    documentId: string,
  ) => Promise<StoredDocument | null>;
  findByPath: (
    projectId: string,
    path: string,
  ) => Promise<StoredDocument | null>;
  createDocument: (input: {
    projectId: string;
    actorUserId: string;
    path: string;
    kind: DocumentKind;
    mime: string | null;
  }) => Promise<StoredDocument>;
  moveNode: (input: {
    projectId: string;
    actorUserId: string;
    path: string;
    nextPath: string;
  }) => Promise<boolean>;
  deleteNode: (input: {
    projectId: string;
    actorUserId: string;
    path: string;
  }) => Promise<StoredDocument[]>;
};

export type DocumentService = {
  getTree: (projectId: string, userId: string) => Promise<FileTreeNode[]>;
  createFile: (input: CreateFileInput) => Promise<StoredDocument>;
  moveNode: (input: MoveNodeInput) => Promise<void>;
  renameNode: (input: RenameNodeInput) => Promise<void>;
  deleteNode: (input: DeleteNodeInput) => Promise<void>;
  getFileContent: (
    input: GetDocumentContentInput,
  ) => Promise<ProjectDocumentContentResponse>;
};

export class InvalidDocumentPathError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class DocumentPathConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
  }
}

export function createDocumentService({
  documentRepository,
  projectAccessService,
  snapshotService,
  snapshotRefreshTrigger,
  binaryContentStore,
}: {
  documentRepository: DocumentRepository;
  projectAccessService: ProjectAccessService;
  snapshotService: SnapshotService;
  snapshotRefreshTrigger: SnapshotRefreshTrigger;
  binaryContentStore: Pick<BinaryContentStore, "delete">;
}): DocumentService {
  return {
    getTree: async (projectId, userId) => {
      await projectAccessService.requireProjectMember(projectId, userId);
      const documents = await documentRepository.listForProject(projectId);

      return buildFileTree(documents);
    },
    createFile: async (input) => {
      await requireDocumentWriteRole(
        projectAccessService,
        input.projectId,
        input.actorUserId,
      );

      const document = await documentRepository.createDocument({
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        path: normalizeDocumentPath(input.path),
        kind: input.kind,
        mime: normalizeMime(input.mime),
      });

      snapshotRefreshTrigger.kick();

      return document;
    },
    moveNode: async (input) => {
      await requireDocumentWriteRole(
        projectAccessService,
        input.projectId,
        input.actorUserId,
      );

      const currentPath = normalizeDocumentPath(input.path);
      const currentName = getPathName(currentPath);
      const destinationParentPath = normalizeOptionalParentPath(
        input.destinationParentPath,
      );
      const nextPath = normalizeDocumentPath(
        joinParentAndName(destinationParentPath, currentName),
      );

      const moved = await documentRepository.moveNode({
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        path: currentPath,
        nextPath,
      });

      if (!moved) {
        throw new DocumentNotFoundError();
      }
      snapshotRefreshTrigger.kick();
    },
    renameNode: async (input) => {
      await requireDocumentWriteRole(
        projectAccessService,
        input.projectId,
        input.actorUserId,
      );

      const currentPath = normalizeDocumentPath(input.path);
      const nextPath = normalizeDocumentPath(
        joinParentAndName(
          getParentPath(currentPath),
          normalizeNodeName(input.name),
        ),
      );

      const renamed = await documentRepository.moveNode({
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        path: currentPath,
        nextPath,
      });

      if (!renamed) {
        throw new DocumentNotFoundError();
      }
      snapshotRefreshTrigger.kick();
    },
    deleteNode: async (input) => {
      await requireDocumentWriteRole(
        projectAccessService,
        input.projectId,
        input.actorUserId,
      );

      const deletedDocuments = await documentRepository.deleteNode({
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        path: normalizeDocumentPath(input.path),
      });

      if (deletedDocuments.length === 0) {
        throw new DocumentNotFoundError();
      }

      const binaryDocuments = deletedDocuments.filter(
        (document) => document.kind === "binary",
      );

      if (binaryDocuments.length > 0) {
        const results = await allSettledInBatches(
          binaryDocuments,
          BINARY_IO_BATCH_SIZE,
          (document) =>
            binaryContentStore.delete(`${input.projectId}/${document.id}`),
        );

        for (const result of results) {
          if (result.status === "rejected") {
            console.error(
              `Failed to clean up binary content after document delete in project ${input.projectId}:`,
              result.reason,
            );
          }
        }
      }

      snapshotRefreshTrigger.kick();
    },
    getFileContent: async (input) => {
      await projectAccessService.requireProjectMember(
        input.projectId,
        input.userId,
      );
      const document = await documentRepository.findByPath(
        input.projectId,
        normalizeDocumentPath(input.path),
      );

      if (!document) {
        throw new DocumentNotFoundError();
      }

      return {
        document: serializeDocument(document),
        content: await snapshotService.loadDocumentContent(document),
      };
    },
  };
}

async function requireDocumentWriteRole(
  projectAccessService: ProjectAccessService,
  projectId: string,
  userId: string,
): Promise<void> {
  await projectAccessService.requireProjectRole(
    projectId,
    userId,
    DOCUMENT_WRITE_ROLES,
  );
}

export function normalizeDocumentPath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed) {
    throw new InvalidDocumentPathError("path is required");
  }

  if (trimmed === "/") {
    throw new InvalidDocumentPathError("path must not be the root path");
  }

  if (trimmed.includes("\\")) {
    throw new InvalidDocumentPathError("path must use forward slashes");
  }

  // Persisted backend document paths are always canonical absolute paths.
  // We still accept relative input here, then normalize it to "/...".
  const relativePath = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const segments = relativePath.split("/");

  if (segments.some((segment) => segment.length === 0)) {
    throw new InvalidDocumentPathError("path must not contain empty segments");
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new InvalidDocumentPathError("path must not contain '.' or '..'");
  }

  const normalizedPath = `/${segments.join("/")}`;

  if (normalizedPath.length > DOCUMENT_PATH_MAX_LENGTH) {
    throw new InvalidDocumentPathError(
      `path must be at most ${DOCUMENT_PATH_MAX_LENGTH} characters`,
    );
  }

  return normalizedPath;
}

export function normalizeOptionalParentPath(
  path: string | null,
): string | null {
  if (path === null) {
    return null;
  }

  const trimmed = path.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "/") {
    return null;
  }

  return normalizeDocumentPath(trimmed);
}

export function normalizeNodeName(name: string): string {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new InvalidDocumentPathError("name is required");
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new InvalidDocumentPathError("name must not contain path separators");
  }

  if (trimmed === "." || trimmed === "..") {
    throw new InvalidDocumentPathError("name must not contain '.' or '..'");
  }

  if (trimmed.length > DOCUMENT_NODE_NAME_MAX_LENGTH) {
    throw new InvalidDocumentPathError(
      `name must be at most ${DOCUMENT_NODE_NAME_MAX_LENGTH} characters`,
    );
  }

  return trimmed;
}

export function joinParentAndName(
  parentPath: string | null,
  name: string,
): string {
  return parentPath ? `${parentPath}/${name}` : `/${name}`;
}

export function getParentPath(path: string): string | null {
  const lastSlashIndex = path.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return null;
  }

  return path.slice(0, lastSlashIndex);
}

export function getPathName(path: string): string {
  const lastSlashIndex = path.lastIndexOf("/");

  return lastSlashIndex === -1 ? path : path.slice(lastSlashIndex + 1);
}

export function normalizeMime(mime: string | undefined): string | null {
  if (mime === undefined) {
    return null;
  }

  const trimmed = mime.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > DOCUMENT_MIME_MAX_LENGTH) {
    throw new InvalidDocumentPathError(
      `mime must be at most ${DOCUMENT_MIME_MAX_LENGTH} characters`,
    );
  }

  return trimmed;
}

export function serializeDocument(document: StoredDocument): ProjectDocument {
  return {
    id: document.id,
    path: document.path,
    kind: document.kind,
    mime: document.mime,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function buildFileTree(documents: StoredDocument[]): FileTreeNode[] {
  type MutableTreeNode =
    | {
        type: "folder";
        name: string;
        path: string;
        children: Map<string, MutableTreeNode>;
      }
    | {
        type: "file";
        name: string;
        path: string;
        documentId: string;
        documentKind: DocumentKind;
        mime: string | null;
      };

  const rootChildren = new Map<string, MutableTreeNode>();

  for (const document of [...documents].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const segments = normalizeDocumentPath(document.path).slice(1).split("/");
    let currentChildren = rootChildren;
    let currentPath = "";

    for (const [index, segment] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : `/${segment}`;
      const isLastSegment = index === segments.length - 1;

      if (isLastSegment) {
        currentChildren.set(segment, {
          type: "file",
          name: segment,
          path: currentPath,
          documentId: document.id,
          documentKind: document.kind,
          mime: document.mime,
        });
        continue;
      }

      const existingNode = currentChildren.get(segment);

      if (existingNode && existingNode.type === "file") {
        throw new Error("File tree cannot place a folder under a file path");
      }

      if (existingNode) {
        currentChildren = existingNode.children;
        continue;
      }

      const folderNode: MutableTreeNode = {
        type: "folder",
        name: segment,
        path: currentPath,
        children: new Map(),
      };
      currentChildren.set(segment, folderNode);
      currentChildren = folderNode.children;
    }
  }

  return sortTreeNodes([...rootChildren.values()]);
}

function sortTreeNodes(
  nodes: Array<
    | {
        type: "folder";
        name: string;
        path: string;
        children: Map<string, unknown>;
      }
    | {
        type: "file";
        name: string;
        path: string;
        documentId: string;
        documentKind: DocumentKind;
        mime: string | null;
      }
  >,
): FileTreeNode[] {
  return [...nodes]
    .map((node) =>
      node.type === "folder"
        ? {
            ...node,
            children: sortTreeNodes([...node.children.values()] as never[]),
          }
        : node,
    )
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}
