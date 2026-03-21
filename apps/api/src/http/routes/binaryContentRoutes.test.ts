import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app.js";
import { signToken, type AuthService } from "../../services/auth.js";
import {
  BinaryContentValidationError,
  type BinaryContentService,
} from "../../services/binaryContent.js";
import { DocumentNotFoundError } from "../../services/document.js";
import type { CommentService } from "../../services/commentService.js";
import type { MembershipService } from "../../services/membership.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/project.js";
import { testConfig } from "../../test/helpers/appFactory.js";

describe("binary content routes", () => {
  const PROJECT_ID = "6f35c2aa-fd34-4905-a370-7d9642244166";
  const FILE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

  it("uploads binary content and returns 204", async () => {
    const binaryContentService = createMockBinaryContentService();
    binaryContentService.uploadContent.mockResolvedValue(undefined);
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("png data"), "image.png")
      .expect(204);

    expect(binaryContentService.uploadContent).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      actorUserId: "user-1",
      fileId: FILE_ID,
      content: expect.any(Buffer),
    });
  });

  it("returns 400 when no file is attached", async () => {
    const binaryContentService = createMockBinaryContentService();
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(400)
      .expect({ error: "file is required" });
  });

  it("returns 400 for invalid projectId", async () => {
    const binaryContentService = createMockBinaryContentService();
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/not-a-uuid/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });
  });

  it("returns 400 for invalid fileId", async () => {
    const binaryContentService = createMockBinaryContentService();
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/not-a-uuid/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(400)
      .expect({ error: "fileId must be a valid UUID" });
  });

  it("returns 401 without a token", async () => {
    const binaryContentService = createMockBinaryContentService();
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(401);
  });

  it("returns 403 when user lacks required role", async () => {
    const binaryContentService = createMockBinaryContentService();
    binaryContentService.uploadContent.mockRejectedValue(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(403)
      .expect({ error: "required project role missing" });
  });

  it("returns 404 when project is not found", async () => {
    const binaryContentService = createMockBinaryContentService();
    binaryContentService.uploadContent.mockRejectedValue(
      new ProjectNotFoundError(),
    );
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(404)
      .expect({ error: "project not found" });
  });

  it("returns 404 when document is not found", async () => {
    const binaryContentService = createMockBinaryContentService();
    binaryContentService.uploadContent.mockRejectedValue(
      new DocumentNotFoundError(),
    );
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(404)
      .expect({ error: "document not found" });
  });

  it("returns 400 when document is not binary", async () => {
    const binaryContentService = createMockBinaryContentService();
    binaryContentService.uploadContent.mockRejectedValue(
      new BinaryContentValidationError(
        "content upload is only allowed for binary documents",
      ),
    );
    const app = createTestApp(binaryContentService);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", Buffer.from("data"), "image.png")
      .expect(400)
      .expect({
        error: "content upload is only allowed for binary documents",
      });
  });
});

function createMockBinaryContentService() {
  return {
    uploadContent: vi
      .fn<BinaryContentService["uploadContent"]>()
      .mockResolvedValue(undefined),
  };
}

function createTestApp(binaryContentService: BinaryContentService) {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    binaryContentService,
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
    snapshotManagementService: createStubSnapshotManagementService(),
  });
}

function createStubAuthService(): AuthService {
  return {
    register: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
    login: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
    getAuthenticatedUser: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
  };
}

function createStubCommentService(): CommentService {
  return {
    listThreads: async () => [],
    createThread: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
    replyToThread: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
  };
}

function createStubDocumentService() {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("stub");
    },
    moveNode: async () => {},
    renameNode: async () => {},
    deleteNode: async () => {},
    getFileContent: async () => {
      throw new Error("stub");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for binary content route tests");
    },
  };
}

function createStubProjectService() {
  return {
    createProject: async () => {
      throw new Error("stub");
    },
    listProjects: async () => [],
    getProject: async () => {
      throw new Error("stub");
    },
    updateProject: async () => {
      throw new Error("stub");
    },
    deleteProject: async () => {
      throw new Error("stub");
    },
  };
}

function createToken() {
  return signToken("user-1", testConfig.jwtSecret);
}
