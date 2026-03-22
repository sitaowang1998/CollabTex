import type { DatabaseClient } from "../infrastructure/db/client.js";

export type CompileBuildRepository = {
  saveLatestBuildPath(projectId: string, storagePath: string): Promise<void>;
  getLatestBuildPath(projectId: string): Promise<string | null>;
};

export function createCompileBuildRepository(
  databaseClient: DatabaseClient,
): CompileBuildRepository {
  return {
    saveLatestBuildPath: async (projectId, storagePath) => {
      await databaseClient.project.updateMany({
        where: { id: projectId },
        data: { latestCompileArtifactPath: storagePath },
      });
    },
    getLatestBuildPath: async (projectId) => {
      const row = await databaseClient.project.findUnique({
        where: { id: projectId },
        select: { latestCompileArtifactPath: true },
      });

      return row?.latestCompileArtifactPath ?? null;
    },
  };
}
