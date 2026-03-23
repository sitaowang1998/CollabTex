import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app.js";
import { signToken, type AuthService } from "../../services/auth.js";
import type { CommentService } from "../../services/commentService.js";
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
import {
  createStubBinaryContentService,
  testConfig,
} from "../../test/helpers/appFactory.js";

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

  it("returns snapshot content with documents and comment threads", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    snapshotManagementService.getSnapshotContent.mockResolvedValue({
      snapshot: {
        id: "7aa64dc2-f494-43c2-ad99-98d0ec4afd2b",
        projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
        message: "initial",
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        storagePath: "project-1/snapshot.json",
      },
      state: {
        documents: {
          "doc-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            textContent: "\\section{Hello}",
          },
          "doc-2": {
            path: "/image.png",
            kind: "binary",
            mime: "image/png",
            binaryContentBase64: "iVBORw0KGgo=",
          },
        },
        commentThreads: [
          {
            id: "thread-1",
            documentId: "doc-1",
            status: "open",
            startAnchor: "a1",
            endAnchor: "a2",
            quotedText: "Hello",
            createdAt: "2026-03-01T12:00:00.000Z",
            updatedAt: "2026-03-01T12:00:00.000Z",
            comments: [
              {
                id: "comment-1",
                authorId: "user-1",
                body: "Looks good",
                createdAt: "2026-03-01T12:00:00.000Z",
              },
            ],
          },
        ],
      },
    });
    const app = createSnapshotTestApp(snapshotManagementService);

    const response = await request(app)
      .get(
        "/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/snapshots/7aa64dc2-f494-43c2-ad99-98d0ec4afd2b",
      )
      .set("authorization", `Bearer ${createToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      snapshot: {
        id: "7aa64dc2-f494-43c2-ad99-98d0ec4afd2b",
        projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
        message: "initial",
        authorId: "user-1",
        createdAt: "2026-03-01T12:00:00.000Z",
      },
      documents: [
        {
          documentId: "doc-1",
          path: "/main.tex",
          kind: "text",
          mime: null,
          textContent: "\\section{Hello}",
        },
        {
          documentId: "doc-2",
          path: "/image.png",
          kind: "binary",
          mime: "image/png",
          textContent: null,
        },
      ],
      commentThreads: [
        {
          id: "thread-1",
          documentId: "doc-1",
          status: "open",
          startAnchor: "a1",
          endAnchor: "a2",
          quotedText: "Hello",
          createdAt: "2026-03-01T12:00:00.000Z",
          updatedAt: "2026-03-01T12:00:00.000Z",
          comments: [
            {
              id: "comment-1",
              authorId: "user-1",
              body: "Looks good",
              createdAt: "2026-03-01T12:00:00.000Z",
            },
          ],
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
      .expect(500)
      .expect({ error: "snapshot data is unavailable" });

    await request(app)
      .post(`/api/projects/${projectId}/snapshots/${snapshotId}/restore`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(422)
      .expect({ error: "snapshot payload uses an unsupported format" });
  });

  it("maps errors from the get snapshot content endpoint", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    snapshotManagementService.getSnapshotContent
      .mockRejectedValueOnce(new SnapshotNotFoundError())
      .mockRejectedValueOnce(new ProjectNotFoundError())
      .mockRejectedValueOnce(new SnapshotDataNotFoundError());
    const app = createSnapshotTestApp(snapshotManagementService);
    const projectId = "6f35c2aa-fd34-4905-a370-7d9642244166";
    const snapshotId = "7aa64dc2-f494-43c2-ad99-98d0ec4afd2b";

    await request(app)
      .get(`/api/projects/${projectId}/snapshots/${snapshotId}`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(404)
      .expect({ error: "snapshot not found" });

    await request(app)
      .get(`/api/projects/${projectId}/snapshots/${snapshotId}`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(404)
      .expect({ error: "project not found" });

    await request(app)
      .get(`/api/projects/${projectId}/snapshots/${snapshotId}`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(500)
      .expect({ error: "snapshot data is unavailable" });
  });

  it("rejects invalid snapshot id with 400", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    const app = createSnapshotTestApp(snapshotManagementService);

    await request(app)
      .get(
        "/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/snapshots/not-a-uuid",
      )
      .set("authorization", `Bearer ${createToken()}`)
      .expect(400);
  });

  it("returns empty documents and null comment threads for legacy snapshots", async () => {
    const snapshotManagementService = createSnapshotManagementService();
    snapshotManagementService.getSnapshotContent.mockResolvedValue({
      snapshot: {
        id: "7aa64dc2-f494-43c2-ad99-98d0ec4afd2b",
        projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
        message: null,
        authorId: null,
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
        storagePath: "project-1/snapshot.json",
      },
      state: {
        documents: {},
        commentThreads: null,
      },
    });
    const app = createSnapshotTestApp(snapshotManagementService);

    const response = await request(app)
      .get(
        "/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/snapshots/7aa64dc2-f494-43c2-ad99-98d0ec4afd2b",
      )
      .set("authorization", `Bearer ${createToken()}`)
      .expect(200);

    expect(response.body.documents).toEqual([]);
    expect(response.body.commentThreads).toBeNull();
  });
});

function createSnapshotTestApp(
  snapshotManagementService: SnapshotManagementService,
) {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    binaryContentService: createStubBinaryContentService(),
    commentService: createStubCommentService(),
    compileDispatchService: {
      compile: async () => {
        throw new Error("stub");
      },
    },
    compileRetrievalService: {
      getLatestPdf: async () => {
        throw new Error("stub");
      },
    },
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
    projectService: createStubProjectService(),
    snapshotManagementService,
  });
}

function createSnapshotManagementService() {
  return {
    listSnapshots: vi.fn<SnapshotManagementService["listSnapshots"]>(),
    getSnapshotContent:
      vi.fn<SnapshotManagementService["getSnapshotContent"]>(),
    restoreSnapshot: vi.fn<SnapshotManagementService["restoreSnapshot"]>(),
  };
}

function createStubCommentService(): CommentService {
  return {
    listThreads: async () => [],
    createThread: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
    replyToThread: async () => {
      throw new Error("Not implemented for snapshot route tests");
    },
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
