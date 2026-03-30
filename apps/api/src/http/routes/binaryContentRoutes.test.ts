import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app.js";
import { signToken, type AuthService } from "../../services/auth.js";
import {
  BinaryContentNotFoundError,
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

  it("returns 413 when file exceeds size limit", async () => {
    const binaryContentService = createMockBinaryContentService();
    const app = createTestApp(binaryContentService);

    // multer is configured with 50 MB limit; send a buffer just over it
    const oversizedBuffer = Buffer.alloc(50 * 1024 * 1024 + 1);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
      .set("authorization", `Bearer ${createToken()}`)
      .attach("file", oversizedBuffer, "huge.bin")
      .expect(413)
      .expect({ error: "file exceeds maximum size of 50 MB" });

    expect(binaryContentService.uploadContent).not.toHaveBeenCalled();
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

  describe("POST /api/projects/:projectId/files/upload", () => {
    it("creates binary file and returns 201", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/files/upload`)
        .set("authorization", `Bearer ${createToken()}`)
        .field("path", "/images/photo.png")
        .attach("file", Buffer.from("png data"), "photo.png")
        .expect(201);

      expect(res.body.document).toBeDefined();
      expect(binaryContentService.createBinaryFile).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        actorUserId: "user-1",
        path: "/images/photo.png",
        mime: "image/png",
        content: expect.any(Buffer),
      });
    });

    it("returns 400 when no file is attached", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .post(`/api/projects/${PROJECT_ID}/files/upload`)
        .set("authorization", `Bearer ${createToken()}`)
        .field("path", "/images/photo.png")
        .expect(400)
        .expect({ error: "file is required" });
    });

    it("returns 400 when path is missing", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .post(`/api/projects/${PROJECT_ID}/files/upload`)
        .set("authorization", `Bearer ${createToken()}`)
        .attach("file", Buffer.from("data"), "image.png")
        .expect(400)
        .expect({ error: "path is required" });
    });

    it("returns 400 for invalid projectId", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .post(`/api/projects/not-a-uuid/files/upload`)
        .set("authorization", `Bearer ${createToken()}`)
        .field("path", "/images/photo.png")
        .attach("file", Buffer.from("data"), "image.png")
        .expect(400)
        .expect({ error: "projectId must be a valid UUID" });
    });

    it("returns 401 without a token", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .post(`/api/projects/${PROJECT_ID}/files/upload`)
        .field("path", "/images/photo.png")
        .attach("file", Buffer.from("data"), "image.png")
        .expect(401);
    });

    it("returns 413 when file exceeds size limit", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      const oversizedBuffer = Buffer.alloc(50 * 1024 * 1024 + 1);

      await request(app)
        .post(`/api/projects/${PROJECT_ID}/files/upload`)
        .set("authorization", `Bearer ${createToken()}`)
        .field("path", "/images/huge.bin")
        .attach("file", oversizedBuffer, "huge.bin")
        .expect(413)
        .expect({ error: "file exceeds maximum size of 50 MB" });

      expect(binaryContentService.createBinaryFile).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/projects/:projectId/files/:fileId/content", () => {
    it("downloads binary content and returns 200", async () => {
      const binaryContentService = createMockBinaryContentService();
      const content = Buffer.from("png data");
      binaryContentService.downloadContent.mockResolvedValue(content);
      const app = createTestApp(binaryContentService);

      const response = await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(200)
        .expect("content-type", /application\/octet-stream/);

      expect(Buffer.from(response.body).toString()).toBe("png data");
      expect(binaryContentService.downloadContent).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        actorUserId: "user-1",
        fileId: FILE_ID,
      });
    });

    it("returns 401 without a token", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
        .expect(401);
    });

    it("returns 400 for invalid projectId", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/not-a-uuid/files/${FILE_ID}/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(400)
        .expect({ error: "projectId must be a valid UUID" });
    });

    it("returns 400 for invalid fileId", async () => {
      const binaryContentService = createMockBinaryContentService();
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/not-a-uuid/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(400)
        .expect({ error: "fileId must be a valid UUID" });
    });

    it("returns 404 when project is not found", async () => {
      const binaryContentService = createMockBinaryContentService();
      binaryContentService.downloadContent.mockRejectedValue(
        new ProjectNotFoundError(),
      );
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(404)
        .expect({ error: "project not found" });
    });

    it("returns 404 when document is not found", async () => {
      const binaryContentService = createMockBinaryContentService();
      binaryContentService.downloadContent.mockRejectedValue(
        new DocumentNotFoundError(),
      );
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(404)
        .expect({ error: "document not found" });
    });

    it("returns 404 when binary content is not found", async () => {
      const binaryContentService = createMockBinaryContentService();
      binaryContentService.downloadContent.mockRejectedValue(
        new BinaryContentNotFoundError(),
      );
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(404)
        .expect({ error: "binary content not found" });
    });

    it("returns 400 when document is not binary", async () => {
      const binaryContentService = createMockBinaryContentService();
      binaryContentService.downloadContent.mockRejectedValue(
        new BinaryContentValidationError(
          "content download is only allowed for binary documents",
        ),
      );
      const app = createTestApp(binaryContentService);

      await request(app)
        .get(`/api/projects/${PROJECT_ID}/files/${FILE_ID}/content`)
        .set("authorization", `Bearer ${createToken()}`)
        .expect(400)
        .expect({
          error: "content download is only allowed for binary documents",
        });
    });
  });
});

function createMockBinaryContentService() {
  return {
    uploadContent: vi
      .fn<BinaryContentService["uploadContent"]>()
      .mockResolvedValue(undefined),
    downloadContent: vi
      .fn<BinaryContentService["downloadContent"]>()
      .mockResolvedValue(Buffer.from("")),
    createBinaryFile: vi
      .fn<BinaryContentService["createBinaryFile"]>()
      .mockResolvedValue({
        id: "new-doc-id",
        projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
        path: "/uploaded.png",
        kind: "binary" as const,
        mime: "image/png",
        contentHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
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
