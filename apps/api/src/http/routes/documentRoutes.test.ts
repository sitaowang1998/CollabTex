import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app.js";
import type { AppConfig } from "../../config/appConfig.js";
import { signToken, type AuthService } from "../../services/auth.js";
import {
  DocumentNotFoundError,
  DocumentPathConflictError,
  type DocumentService,
  type StoredDocument,
} from "../../services/document.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  type ProjectService,
} from "../../services/project.js";
import type { MembershipService } from "../../services/membership.js";

const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 0,
  jwtSecret: "test_secret",
  clientOrigin: "http://localhost:5173",
  databaseUrl:
    "postgresql://invalid:invalid@invalid.invalid:5432/invalid?schema=public",
};

describe("document routes", () => {
  it("lists the file tree for an authenticated project member", async () => {
    const documentService = createStubDocumentService();
    documentService.getTree.mockResolvedValue([
      {
        type: "folder",
        name: "docs",
        path: "/docs",
        children: [
          {
            type: "file",
            name: "main.tex",
            path: "/docs/main.tex",
            documentId: "document-1",
            documentKind: "text",
            mime: null,
          },
        ],
      },
    ]);
    const app = createDocumentTestApp(documentService);

    const response = await request(app)
      .get("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/tree")
      .set("authorization", `Bearer ${createToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      nodes: [
        {
          type: "folder",
          name: "docs",
          path: "/docs",
          children: [
            {
              type: "file",
              name: "main.tex",
              path: "/docs/main.tex",
              documentId: "document-1",
              documentKind: "text",
              mime: null,
            },
          ],
        },
      ],
    });
    expect(documentService.getTree).toHaveBeenCalledWith(
      "6f35c2aa-fd34-4905-a370-7d9642244166",
      "user-1",
    );
  });

  it("creates files and serializes the stored document", async () => {
    const documentService = createStubDocumentService();
    documentService.createFile.mockResolvedValue(
      createStoredDocument({
        path: "/docs/main.tex",
      }),
    );
    const app = createDocumentTestApp(documentService);

    const response = await request(app)
      .post("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/files")
      .set("authorization", `Bearer ${createToken()}`)
      .send({
        path: " docs/main.tex ",
        kind: "text",
        mime: " text/plain ",
      })
      .expect(201);

    expect(response.body).toEqual({
      document: {
        id: "document-1",
        path: "/docs/main.tex",
        kind: "text",
        mime: null,
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
    });
    expect(documentService.createFile).toHaveBeenCalledWith({
      projectId: "6f35c2aa-fd34-4905-a370-7d9642244166",
      actorUserId: "user-1",
      path: "docs/main.tex",
      kind: "text",
      mime: "text/plain",
    });
  });

  it("allows root moves and loads file content by path", async () => {
    const documentService = createStubDocumentService();
    documentService.getFileContent.mockResolvedValue({
      document: {
        id: "document-1",
        path: "/main.tex",
        kind: "text",
        mime: null,
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
      content: "",
    });
    const app = createDocumentTestApp(documentService);
    const projectId = "6f35c2aa-fd34-4905-a370-7d9642244166";

    await request(app)
      .patch(`/api/projects/${projectId}/nodes/move`)
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "/docs/main.tex", destinationParentPath: null })
      .expect(204);

    const response = await request(app)
      .get(`/api/projects/${projectId}/files/content`)
      .query({ path: "main.tex" })
      .set("authorization", `Bearer ${createToken()}`)
      .expect(200);

    expect(documentService.moveNode).toHaveBeenCalledWith({
      projectId,
      actorUserId: "user-1",
      path: "/docs/main.tex",
      destinationParentPath: null,
    });
    expect(response.body).toEqual({
      document: {
        id: "document-1",
        path: "/main.tex",
        kind: "text",
        mime: null,
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
      content: "",
    });
  });

  it("rejects malformed payloads and malformed project IDs", async () => {
    const app = createDocumentTestApp(createStubDocumentService());

    await request(app)
      .post("/api/projects/not-a-uuid/files")
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "main.tex", kind: "text" })
      .expect(400)
      .expect({ error: "projectId must be a valid UUID" });

    await request(app)
      .post("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/folders")
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "docs" })
      .expect(404);

    await request(app)
      .post("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/files")
      .set("authorization", `Bearer ${createToken()}`)
      .send([])
      .expect(400)
      .expect({ error: "request body must be an object" });

    await request(app)
      .patch("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/nodes/move")
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "main.tex", destinationParentPath: 42 })
      .expect(400)
      .expect({ error: "destinationParentPath must be a string or null" });

    await request(app)
      .get("/api/projects/6f35c2aa-fd34-4905-a370-7d9642244166/files/content")
      .set("authorization", `Bearer ${createToken()}`)
      .expect(400)
      .expect({ error: "path is required" });
  });

  it("maps role, conflict, not found, and missing-token errors", async () => {
    const documentService = createStubDocumentService();
    documentService.createFile.mockRejectedValue(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );
    documentService.renameNode.mockRejectedValue(
      new DocumentPathConflictError("destination path already exists"),
    );
    documentService.deleteNode.mockRejectedValue(new DocumentNotFoundError());
    documentService.getTree.mockRejectedValue(new ProjectNotFoundError());
    const app = createDocumentTestApp(documentService);
    const projectId = "6f35c2aa-fd34-4905-a370-7d9642244166";

    await request(app)
      .post(`/api/projects/${projectId}/files`)
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "/docs/main.tex", kind: "text" })
      .expect(403)
      .expect({ error: "required project role missing" });

    await request(app)
      .patch(`/api/projects/${projectId}/nodes/rename`)
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "/docs/main.tex", name: "main-2.tex" })
      .expect(409)
      .expect({ error: "destination path already exists" });

    await request(app)
      .delete(`/api/projects/${projectId}/nodes`)
      .set("authorization", `Bearer ${createToken()}`)
      .send({ path: "/missing.tex" })
      .expect(404)
      .expect({ error: "document not found" });

    await request(app)
      .get(`/api/projects/${projectId}/tree`)
      .set("authorization", `Bearer ${createToken()}`)
      .expect(404)
      .expect({ error: "project not found" });

    await request(app)
      .get(`/api/projects/${projectId}/tree`)
      .expect(401)
      .expect({
        error: "missing token",
      });
  });
});

function createDocumentTestApp(documentService: DocumentService) {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    documentService,
    membershipService: createStubMembershipService(),
    projectService: createStubProjectService(),
  });
}

function createStubDocumentService() {
  return {
    getTree: vi.fn<DocumentService["getTree"]>().mockResolvedValue([]),
    createFile: vi.fn<DocumentService["createFile"]>(),
    moveNode: vi.fn<DocumentService["moveNode"]>().mockResolvedValue(undefined),
    renameNode: vi
      .fn<DocumentService["renameNode"]>()
      .mockResolvedValue(undefined),
    deleteNode: vi
      .fn<DocumentService["deleteNode"]>()
      .mockResolvedValue(undefined),
    getFileContent: vi.fn<DocumentService["getFileContent"]>(),
  };
}

function createStubAuthService(): AuthService {
  return {
    register: async () => {
      throw new Error("Not implemented for document route tests");
    },
    login: async () => {
      throw new Error("Not implemented for document route tests");
    },
    getAuthenticatedUser: async () => {
      throw new Error("Not implemented for document route tests");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for document route tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for document route tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for document route tests");
    },
  };
}

function createStubProjectService(): ProjectService {
  return {
    createProject: async () => {
      throw new Error("Not implemented for document route tests");
    },
    listProjects: async () => [],
    getProject: async () => {
      throw new Error("Not implemented for document route tests");
    },
    updateProject: async () => {
      throw new Error("Not implemented for document route tests");
    },
    deleteProject: async () => {
      throw new Error("Not implemented for document route tests");
    },
  };
}

function createToken() {
  return signToken("user-1", testConfig.jwtSecret);
}

function createStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text",
    mime: null,
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
