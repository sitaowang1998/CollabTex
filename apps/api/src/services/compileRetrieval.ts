import type { CompileArtifactStore } from "./compile.js";
import type { ProjectAccessService } from "./projectAccess.js";
import type { CompileBuildRepository } from "../repositories/compileBuildRepository.js";

export type CompileRetrievalService = {
  getLatestPdf(projectId: string, userId: string): Promise<Buffer>;
};

export class NoBuildExistsError extends Error {
  constructor() {
    super("No successful build exists for this project");
    this.name = "NoBuildExistsError";
  }
}

export function createCompileRetrievalService({
  projectAccessService,
  compileBuildRepository,
  compileArtifactStore,
}: {
  projectAccessService: Pick<ProjectAccessService, "requireProjectMember">;
  compileBuildRepository: Pick<CompileBuildRepository, "getLatestBuildPath">;
  compileArtifactStore: Pick<CompileArtifactStore, "readPdf">;
}): CompileRetrievalService {
  return {
    getLatestPdf: async (projectId, userId) => {
      await projectAccessService.requireProjectMember(projectId, userId);

      const storagePath =
        await compileBuildRepository.getLatestBuildPath(projectId);

      if (!storagePath) {
        throw new NoBuildExistsError();
      }

      return compileArtifactStore.readPdf(storagePath);
    },
  };
}
