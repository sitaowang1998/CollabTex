import { randomUUID } from "node:crypto";
import type { CompileDoneEvent } from "@collab-tex/shared";
import type { CompileAdapter, CompileArtifactStore } from "./compile.js";
import { DOCUMENT_WRITE_ROLES } from "./document.js";
import type { ProjectAccessService } from "./projectAccess.js";
import type { ProjectService } from "./project.js";
import type {
  ExportedFile,
  FileAssemblyDependencies,
} from "./workspaceExport.js";
import { assembleProjectFiles } from "./workspaceExport.js";

export type CompileDispatchResult = {
  status: "success" | "failure";
  logs: string;
};

export type CompileDispatchService = {
  compile(projectId: string, userId: string): Promise<CompileDispatchResult>;
};

export class CompileAlreadyInProgressError extends Error {
  constructor() {
    super("A compile is already in progress for this project");
    this.name = "CompileAlreadyInProgressError";
  }
}

export class CompileMainDocumentNotFoundError extends Error {
  constructor() {
    super("No main document found for this project");
    this.name = "CompileMainDocumentNotFoundError";
  }
}

export function createCompileDispatchService({
  projectAccessService,
  projectService,
  fileAssemblyDeps,
  compileAdapter,
  compileArtifactStore,
  compileTimeoutMs,
  notifyCompileDone,
}: {
  projectAccessService: Pick<ProjectAccessService, "requireProjectRole">;
  projectService: Pick<ProjectService, "getMainDocument">;
  fileAssemblyDeps: FileAssemblyDependencies;
  compileAdapter: CompileAdapter;
  compileArtifactStore: CompileArtifactStore;
  compileTimeoutMs: number;
  notifyCompileDone: (projectId: string, event: CompileDoneEvent) => void;
}): CompileDispatchService {
  const compilesInProgress = new Set<string>();

  return {
    compile: async (projectId, userId) => {
      await projectAccessService.requireProjectRole(
        projectId,
        userId,
        DOCUMENT_WRITE_ROLES,
      );

      if (compilesInProgress.has(projectId)) {
        throw new CompileAlreadyInProgressError();
      }

      compilesInProgress.add(projectId);

      try {
        const mainDocument = await projectService.getMainDocument(
          projectId,
          userId,
        );

        if (!mainDocument) {
          throw new CompileMainDocumentNotFoundError();
        }

        const exportedFiles = await assembleProjectFiles(
          fileAssemblyDeps,
          projectId,
        );

        const files = buildFileMap(exportedFiles);
        const mainFile = toRelativePath(mainDocument.path);

        const compileResult = await compileAdapter.compile({
          files,
          mainFile,
          timeoutMs: compileTimeoutMs,
        });

        let status: "success" | "failure";
        let logs: string;

        if (
          compileResult.outcome === "completed" &&
          compileResult.exitCode === 0 &&
          compileResult.pdfContent
        ) {
          status = "success";
          logs = compileResult.logs;

          const storagePath = buildStoragePath(projectId);
          await compileArtifactStore.writePdf(
            storagePath,
            compileResult.pdfContent,
          );
        } else {
          status = "failure";
          logs =
            compileResult.outcome === "timeout"
              ? `Compile timed out after ${compileTimeoutMs}ms\n${compileResult.logs}`
              : compileResult.logs;
        }

        const event: CompileDoneEvent = { projectId, status, logs };
        notifyCompileDone(projectId, event);

        return { status, logs };
      } catch (error) {
        try {
          notifyCompileDone(projectId, {
            projectId,
            status: "failure",
            logs: "An internal error occurred during compilation.",
          });
        } catch {
          // Don't let notification failure mask the original error.
        }

        throw error;
      } finally {
        compilesInProgress.delete(projectId);
      }
    },
  };
}

function buildFileMap(exportedFiles: ExportedFile[]): Map<string, string> {
  const files = new Map<string, string>();

  for (const file of exportedFiles) {
    if (file.kind === "text") {
      files.set(file.relativePath, file.content);
    }
  }

  return files;
}

function toRelativePath(canonicalPath: string): string {
  return canonicalPath.startsWith("/") ? canonicalPath.slice(1) : canonicalPath;
}

function buildStoragePath(projectId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${projectId}/${timestamp}-${randomUUID()}.pdf`;
}
