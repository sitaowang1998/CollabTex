import type { DatabaseClient } from "../infrastructure/db/client.js";
import type { SnapshotRepository } from "../services/snapshot.js";

export function createSnapshotRepository(
  databaseClient: DatabaseClient,
): SnapshotRepository {
  return {
    listForProject: async (projectId) => {
      return databaseClient.snapshot.findMany({
        where: {
          projectId,
          project: {
            tombstoneAt: null,
          },
        },
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
      });
    },
    createSnapshot: async ({ projectId, storagePath, message, authorId }) => {
      return databaseClient.snapshot.create({
        data: {
          projectId,
          storagePath,
          message,
          authorId,
        },
      });
    },
  };
}
