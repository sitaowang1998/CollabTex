import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app.js";
import type { AppConfig } from "../../config/appConfig.js";
import { signToken, type AuthService } from "../../services/auth.js";
import type { DocumentService } from "../../services/document.js";
import type { MembershipService } from "../../services/membership.js";
import type { ProjectService } from "../../services/project.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  SnapshotNotFoundError,
  type SnapshotManagementService,
} from "../../services/snapshotManagement.js";
import {
  InvalidSnapshotDataError,
  SnapshotDataNotFoundError,
} from "../../services/snapshot.js";

const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 0,
  jwtSecret: "test_secret",
  clientOrigin: "http://localhost:5173",
  databaseUrl:
    "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public",
  snapshotStorageRoot: "/tmp/collabtex-test-snapshots",
};

describe("snapshot routes", () => {
  it("lists snapshots for an authenticated project member", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    snapshotManagementService.listSnapshots.mockResolvedValue([
      {
        id: "snapshot-1",
        projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        storagePath: "project-1/snapshot.json",
      },
    ]);
    const app = createSnapshotTestApp(snapshotManagementService);

    const response = await request(app)
      .get("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/snapshots")
      .set("authorization", `Bearer ${createToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      snapshots: [
        {
          id: "snapshot-1",
          projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
          message: null,
          authorId: "user-1",
          createdAt: "2026-03-01T12:00:00.000Z",
        },
      ],
    });
  });

  it("restores a snapshot for editors and admins", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    snapshotManagementService.restoreSnapshot.mockResolvedValue({
      id: "snapshot-2",
      projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
      message: "Restored from snapshot snapshot-1",
      authorId: "user-1",
      createdAt: new Date("2026-03-02T12:00:00.000Z"),
      storagePath: "project-1/restored.json",
    });
    const app = createSnapshotTestApp(snapshotManagementService);

    const response = await request(app)
      .post(
        "/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/snapshots/7aa64dc2-f494-43c2-ad99-98d0ec4afd2b/restore",
      )
      .set("authorization", `Bearer ${createToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      snapshot: {
        id: "snapshot-2",
        projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
        message: "Restored from snapshot snapshot-1",
        authorId: "user-1",
        createdAt: "2026-03-02T12:00:00.000Z",
      },
    });
  });

  it("maps not found, forbidden, and unreadable snapshot errors", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    snapshotManagementService.listSnapshots.mockRejectedValue(
      new ProjectNotFoundError(),
    );
    snapshotManagementService.restoreSnapshot
      .mockRejectedValueOnce(new ProjectRoleRequiredError(["admin", "editor"]))
      .mockRejectedValueOnce(new SnapshotNotFoundError())
      .mockRejectedValueOnce(new SnapshotDataNotFoundError())
      .mockRejectedValueOnce(
        new InvalidSnapshotDataError(
          "snapshot payload uses an unsupported format",
        ),
      );
    const app = createSnapshotTestApp(snapshotManagementService);
    const projectId = "6f35c2aa-fd34-4905-a370-7d9642244166";
    const snapshotId = "7aa64dc2-f494-43c2-ad99-98d0ec4afd2b";

    await request(app)
      .get(`/api/projects/${projectId}/snapshots`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(404)
      .expect({ error: "project not found" });

    await request(app)
      .post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(403)
      .expect({ error: "required project role missing" });

    await request(app)
      .post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(404)
      .expect({ error: "snapshot not found" });

    await request(app)
      .post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(422)
      .expect({ error: "selected snapshot data is missing" });

    await request(app)
      .post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(422)
      .expect({ error: "snapshot payload uses an unsupported format" });
  });
});

function createSnapshotTestApp(
  snapshotManagementService: SnapshotManagementService,
) {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
    projectService: createStubProjectService(),
    snapshotManagementService,
  });
}

function createSnapshotManagementService() {
  return {
    listSnapshots: vi.fn<SnapshotManagementService["listSnapshots"]>(),
    restoreSnapshot: vi.fn<SnapshotManagementService["restoreSnapshot"]>(),
  };
}

function createStubAuthService(): AuthService {
  return {
    register: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    login: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    getAuthenticatedUser: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
  };
}

function createStubDocumentService(): DocumentService {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    moveNode: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    renameNode: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    deleteNode: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    getFileContent: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
  };
}

function createStubProjectService(): ProjectService {
  return {
    createProject: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    listProjects: async () => [],
    getProject: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    updateProject: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    deleteProject: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
  };
}

function createToken() {
  return signToken("user-1", testConfig.jwtSecret);
}
