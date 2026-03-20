import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DocumentRepository, StoredDocument } from "./document.js";
import type { DocumentTextStateRepository } from "./currentTextState.js";
import {
  loadLatestProjectSnapshotState,
  type ProjectSnapshotState,
  type SnapshotRepository,
  type SnapshotStore,
} from "./snapshot.js";

export type WorkspaceExportResult = {
  directory: string;
  cleanup: () => Promise<void>;
};

export type WorkspaceExportService = {
  exportWorkspace: (projectId: string) => Promise<WorkspaceExportResult>;
};

export function createWorkspaceExportService({
  documentRepository,
  documentTextStateRepository,
  snapshotRepository,
  snapshotStore,
}: {
  documentRepository: Pick<DocumentRepository, "listForProject">;
  documentTextStateRepository: Pick<
    DocumentTextStateRepository,
    "findByDocumentIds"
  >;
  snapshotRepository: Pick<SnapshotRepository, "listForProject">;
  snapshotStore: Pick<SnapshotStore, "readProjectSnapshot">;
}): WorkspaceExportService {
  return {
    exportWorkspace: async (projectId) => {
      const documents = await documentRepository.listForProject(projectId);

      const textDocuments = documents.filter((d) => d.kind === "text");
      const binaryDocuments = documents.filter((d) => d.kind === "binary");

      const [textStateMap, snapshotState] = await Promise.all([
        loadTextStateMap(documentTextStateRepository, textDocuments),
        loadLatestProjectSnapshotState(
          snapshotRepository,
          snapshotStore,
          projectId,
        ),
      ]);

      const directory = join(tmpdir(), `collabtex-workspace-${randomUUID()}`);
      await mkdir(directory, { recursive: true });

      try {
        await writeTextFiles(
          directory,
          textDocuments,
          textStateMap,
          snapshotState,
        );
        await writeBinaryFiles(directory, binaryDocuments, snapshotState);
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }

      return {
        directory,
        cleanup: async () => {
          await rm(directory, { recursive: true, force: true });
        },
      };
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

function resolveExportPath(directory: string, relativePath: string): string {
  const filePath = resolve(directory, relativePath);
  const rel = relative(directory, filePath);

  if (
    !rel ||
    rel === "." ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  ) {
    throw new Error(`File path escapes export directory: ${relativePath}`);
  }

  return filePath;
}

async function writeTextFiles(
  directory: string,
  textDocuments: StoredDocument[],
  textStateMap: Map<string, string>,
  snapshotState: ProjectSnapshotState,
): Promise<void> {
  for (const document of textDocuments) {
    const relativePath = toRelativePath(document.path);
    const filePath = resolveExportPath(directory, relativePath);

    let content = textStateMap.get(document.id);

    if (typeof content !== "string") {
      const snapshotDoc = snapshotState.documents[document.id];
      content =
        snapshotDoc && snapshotDoc.kind === "text"
          ? snapshotDoc.textContent
          : "";
    }

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function writeBinaryFiles(
  directory: string,
  binaryDocuments: StoredDocument[],
  snapshotState: ProjectSnapshotState,
): Promise<void> {
  for (const document of binaryDocuments) {
    const snapshotDoc = snapshotState.documents[document.id];

    if (
      !snapshotDoc ||
      snapshotDoc.kind !== "binary" ||
      !snapshotDoc.binaryContentBase64
    ) {
      continue;
    }

    const relativePath = toRelativePath(document.path);
    const filePath = resolveExportPath(directory, relativePath);
    const bytes = Buffer.from(snapshotDoc.binaryContentBase64, "base64");

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
  }
}
