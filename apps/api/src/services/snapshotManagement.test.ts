import { describe, expect, it, vi } from "vitest";
import {
  createSnapshotManagementService,
} from "./snapshotManagement.js";
import type {
  ProjectAccessService,
  ProjectWithRole,
} from "./projectAccess.js";
import type { SnapshotService, StoredSnapshot } from "./snapshot.js";

describe("snapshot management service", () => {
  it("requires project membership before listing snapshots", async () => {
    const projectAccessService = createProjectAccessService();
    const snapshotService = createSnapshotService();
    projectAccessService.requireProjectMember.mockRejectedValue(
      new Error("membership required"),
    );
    const service = createSnapshotManagementService({
      projectAccessService,
      snapshotService,
    });

    await expect(
      service.listSnapshots({
        projectId: "project-1",
        userId: "user-1",
      }),
    ).rejects.toThrow("membership required");

    expect(projectAccessService.requireProjectMember).toHaveBeenCalledWith(
      "project-1",
      "user-1",
    );
    expect(snapshotService.listProjectSnapshots).not.toHaveBeenCalled();
  });

  it("lists snapshots after membership succeeds", async () => {
    const projectAccessService = createProjectAccessService();
    const snapshotService = createSnapshotService();
    const snapshots = [createStoredSnapshot()];
    projectAccessService.requireProjectMember.mockResolvedValue(
      createProjectWithRole("reader"),
    );
    snapshotService.listProjectSnapshots.mockResolvedValue(snapshots);
    const service = createSnapshotManagementService({
      projectAccessService,
      snapshotService,
    });

    await expect(
      service.listSnapshots({
        projectId: "project-1",
        userId: "user-1",
      }),
    ).resolves.toBe(snapshots);

    expect(snapshotService.listProjectSnapshots).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("requires admin or editor before restoring a snapshot", async () => {
    const projectAccessService = createProjectAccessService();
    const snapshotService = createSnapshotService();
    projectAccessService.requireProjectRole.mockRejectedValue(
      new Error("role required"),
    );
    const service = createSnapshotManagementService({
      projectAccessService,
      snapshotService,
    });

    await expect(
      service.restoreSnapshot({
        projectId: "project-1",
        snapshotId: "snapshot-1",
        userId: "user-1",
      }),
    ).rejects.toThrow("role required");

    expect(projectAccessService.requireProjectRole).toHaveBeenCalledWith(
      "project-1",
      "user-1",
      ["admin", "editor"],
    );
    expect(snapshotService.restoreProjectSnapshot).not.toHaveBeenCalled();
  });

  it("restores a snapshot after role authorization and forwards actorUserId", async () => {
    const projectAccessService = createProjectAccessService();
    const snapshotService = createSnapshotService();
    const restoredSnapshot = createStoredSnapshot({
      id: "snapshot-2",
    });
    projectAccessService.requireProjectRole.mockResolvedValue(
      createProjectWithRole("editor"),
    );
    snapshotService.restoreProjectSnapshot.mockResolvedValue(restoredSnapshot);
    const service = createSnapshotManagementService({
      projectAccessService,
      snapshotService,
    });

    await expect(
      service.restoreSnapshot({
        projectId: "project-1",
        snapshotId: "snapshot-1",
        userId: "user-1",
      }),
    ).resolves.toBe(restoredSnapshot);

    expect(snapshotService.restoreProjectSnapshot).toHaveBeenCalledWith({
      projectId: "project-1",
      snapshotId: "snapshot-1",
      actorUserId: "user-1",
    });
  });
});

function createProjectAccessService() {
  return {
    requireProjectMember: vi.fn<ProjectAccessService["requireProjectMember"]>(),
    requireProjectRole: vi.fn<ProjectAccessService["requireProjectRole"]>(),
  };
}

function createSnapshotService(): Pick<
  SnapshotService,
  "listProjectSnapshots" | "restoreProjectSnapshot"
> {
  return {
    listProjectSnapshots: vi.fn<SnapshotService["listProjectSnapshots"]>(),
    restoreProjectSnapshot: vi.fn<SnapshotService["restoreProjectSnapshot"]>(),
  };
}

function createProjectWithRole(
  role: ProjectWithRole["myRole"],
): ProjectWithRole {
  return {
    project: {
      id: "project-1",
      name: "Project One",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
      tombstoneAt: null,
    },
    myRole: role,
  };
}

function createStoredSnapshot(
  overrides: Partial<StoredSnapshot> = {},
): StoredSnapshot {
  return {
    id: "snapshot-1",
    projectId: "project-1",
    storagePath: "project-1/snapshot.json",
    message: null,
    authorId: "user-1",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
