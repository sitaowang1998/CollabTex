import type { DocumentRepository, StoredDocument } from "./document.js";
import type { DocumentTextStateRepository } from "./currentTextState.js";
import {
  loadLatestProjectSnapshotState,
  type ProjectSnapshotState,
  type SnapshotRepository,
  type SnapshotStore,
} from "./snapshot.js";

export type ExportedFile =
  | { relativePath: string; kind: "text"; content: string }
  | { relativePath: string; kind: "binary"; content: Buffer };

export type WorkspaceExportResult = {
  directory: string;
  cleanup: () => Promise<void>;
};

export type WorkspaceWriter = {
  writeWorkspace: (files: ExportedFile[]) => Promise<WorkspaceExportResult>;
};

export type WorkspaceExportService = {
  exportWorkspace: (projectId: string) => Promise<WorkspaceExportResult>;
};

export type FileAssemblyDependencies = {
  documentRepository: Pick<DocumentRepository, "listForProject">;
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentIds"
  >;
  snapshotRepository: Pick<SnapshotRepository, "listForProject">;
  snapshotStore: Pick<SnapshotStore, "readProjectSnapshot">;
};

export async function assembleProjectFiles(
  deps: FileAssemblyDependencies,
  projectId: string,
): Promise<ExportedFile[]> {
  const documents = await deps.documentRepository.listForProject(projectId);

  const textDocuments = documents.filter((d) => d.kind === "text");
  const binaryDocuments = documents.filter((d) => d.kind === "binary");

  const [textStateMap, snapshotState] = await Promise.all([
    loadTextStateMap(deps.documentTextStateRepository, textDocuments),
    loadLatestProjectSnapshotState(
      deps.snapshotRepository,
      deps.snapshotStore,
      projectId,
    ),
  ]);

  return [
    ...assembleTextFiles(textDocuments, textStateMap, snapshotState),
    ...assembleBinaryFiles(binaryDocuments, snapshotState),
  ];
}

export function createWorkspaceExportService({
  documentRepository,
  documentTextStateRepository,
  snapshotRepository,
  snapshotStore,
  workspaceWriter,
}: FileAssemblyDependencies & {
  workspaceWriter: WorkspaceWriter;
}): WorkspaceExportService {
  return {
    exportWorkspace: async (projectId) => {
      const files = await assembleProjectFiles(
        {
          documentRepository,
          documentTextStateRepository,
          snapshotRepository,
          snapshotStore,
        },
        projectId,
      );

      return workspaceWriter.writeWorkspace(files);
    },
  };
}

async function loadTextStateMap(
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentIds"
  >,
  textDocuments: StoredDocument[],
): Promise<Map<string, string>> {
  const ids = textDocuments.map((d) => d.id);

  if (ids.length === 0) {
    return new Map();
  }

  const states = await documentTextStateRepository.findByDocumentIds(ids);

  return new Map(states.map((s) => [s.documentId, s.textContent]));
}

function toRelativePath(canonicalPath: string): string {
  return canonicalPath.startsWith("/") ? canonicalPath.slice(1) : canonicalPath;
}

function assembleTextFiles(
  textDocuments: StoredDocument[],
  textStateMap: Map<string, string>,
  snapshotState: ProjectSnapshotState,
): ExportedFile[] {
  return textDocuments.map((document) => {
    let content = textStateMap.get(document.id);

    if (typeof content !== "string") {
      const snapshotDoc = snapshotState.documents[document.id];

      if (snapshotDoc && snapshotDoc.kind === "text") {
        content = snapshotDoc.textContent;
      } else {
        console.warn(
          `Workspace export: text document "${document.path}" (${document.id}) has no content, exporting as empty file`,
        );
        content = "";
      }
    }

    return {
      relativePath: toRelativePath(document.path),
      kind: "text" as const,
      content,
    };
  });
}

function assembleBinaryFiles(
  binaryDocuments: StoredDocument[],
  snapshotState: ProjectSnapshotState,
): ExportedFile[] {
  const files: ExportedFile[] = [];

  for (const document of binaryDocuments) {
    const snapshotDoc = snapshotState.documents[document.id];

    if (
      !snapshotDoc ||
      snapshotDoc.kind !== "binary" ||
      typeof snapshotDoc.binaryContentBase64 !== "string"
    ) {
      console.warn(
        `Workspace export: binary document "${document.path}" (${document.id}) has no content, skipping`,
      );
      continue;
    }

    files.push({
      relativePath: toRelativePath(document.path),
      kind: "binary" as const,
      content: Buffer.from(snapshotDoc.binaryContentBase64, "base64"),
    });
  }

  return files;
}
