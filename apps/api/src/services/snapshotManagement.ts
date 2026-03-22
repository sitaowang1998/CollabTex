import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  type ProjectAccessService,
} from "./projectAccess.js";
import {
  SnapshotNotFoundError,
  type ProjectSnapshotState,
  type SnapshotService,
  type StoredSnapshot,
} from "./snapshot.js";

const SNAPSHOT_RESTORE_ROLES = ["admin", "editor"] as const;

export type SnapshotManagementService = {
  listSnapshots: (input: {
    projectId: string;
    userId: string;
  }) => Promise<StoredSnapshot[]>;
  getSnapshotContent: (input: {
    projectId: string;
    snapshotId: string;
    userId: string;
  }) => Promise<{ snapshot: StoredSnapshot; state: ProjectSnapshotState }>;
  restoreSnapshot: (input: {
    projectId: string;
    snapshotId: string;
    userId: string;
  }) => Promise<StoredSnapshot>;
};

export {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  SnapshotNotFoundError,
};

export function createSnapshotManagementService({
  projectAccessService,
  snapshotService,
}: {
  projectAccessService: ProjectAccessService;
  snapshotService: Pick<
    SnapshotService,
    | "listProjectSnapshots"
    | "getProjectSnapshotContent"
    | "restoreProjectSnapshot"
  >;
}): SnapshotManagementService {
  return {
    listSnapshots: async ({ projectId, userId }) => {
      await projectAccessService.requireProjectMember(projectId, userId);
      return snapshotService.listProjectSnapshots(projectId);
    },
    getSnapshotContent: async ({ projectId, snapshotId, userId }) => {
      await projectAccessService.requireProjectMember(projectId, userId);
      return snapshotService.getProjectSnapshotContent({
        projectId,
        snapshotId,
      });
    },
    restoreSnapshot: async ({ projectId, snapshotId, userId }) => {
      await projectAccessService.requireProjectRole(
        projectId,
        userId,
        SNAPSHOT_RESTORE_ROLES,
      );

      return snapshotService.restoreProjectSnapshot({
        projectId,
        snapshotId,
        actorUserId: userId,
      });
    },
  };
}
