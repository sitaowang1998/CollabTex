import { randomUUID } from "node:crypto";
import type { CompileDoneEvent } from "@collab-tex/shared";
import type { CompileAdapter, CompileArtifactStore } from "./compile.js";
import { DOCUMENT_WRITE_ROLES } from "./document.js";
import type { ProjectAccessService } from "./projectAccess.js";
import type { ProjectService } from "./project.js";
import type { CompileBuildRepository } from "../repositories/compileBuildRepository.js";
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
  compileBuildRepository,
  compileTimeoutMs,
  notifyCompileDone,
}: {
  projectAccessService: Pick<ProjectAccessService, "requireProjectRole">;
  projectService: Pick<ProjectService, "getMainDocument">;
  fileAssemblyDeps: FileAssemblyDependencies;
  compileAdapter: CompileAdapter;
  compileArtifactStore: CompileArtifactStore;
  compileBuildRepository: Pick<CompileBuildRepository, "saveLatestBuildPath">;
  compileTimeoutMs: number;
  notifyCompileDone: (event: CompileDoneEvent) => void;
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
          try {
            await compileBuildRepository.saveLatestBuildPath(
              projectId,
              storagePath,
            );
          } catch (persistError) {
            console.error(
              "Failed to persist build path after successful compile",
              { projectId, storagePath },
              persistError,
            );
          }
        } else {
          status = "failure";

          if (compileResult.outcome === "timeout") {
            logs = `Compile timed out after ${compileTimeoutMs}ms\n${compileResult.logs}`;
          } else if (
            compileResult.outcome === "completed" &&
            compileResult.exitCode === 0
          ) {
            logs = `Compilation exited successfully but no PDF was produced.\n${compileResult.logs}`;
          } else {
            logs = compileResult.logs;
          }
        }

        const event: CompileDoneEvent = { projectId, status, logs };
        notifyCompileDone(event);

        return { status, logs };
      } catch (error) {
        try {
          const logs =
            error instanceof CompileMainDocumentNotFoundError
              ? "No main document found for this project."
              : "An internal error occurred during compilation.";

          notifyCompileDone({
            projectId,
            status: "failure",
            logs,
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

function buildFileMap(
  exportedFiles: ExportedFile[],
): Map<string, string | Buffer> {
  const files = new Map<string, string | Buffer>();

  for (const file of exportedFiles) {
    files.set(file.relativePath, file.content);
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
