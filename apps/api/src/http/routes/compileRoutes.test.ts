import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../app.js";
import { signToken } from "../../services/auth.js";
import {
  CompileAlreadyInProgressError,
  CompileMainDocumentNotFoundError,
  type CompileDispatchService,
} from "../../services/compileDispatch.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/projectAccess.js";
import type { AuthService } from "../../services/auth.js";
import type { CommentService } from "../../services/commentService.js";
import type { DocumentService } from "../../services/document.js";
import type { MembershipService } from "../../services/membership.js";
import type { ProjectService } from "../../services/project.js";
import type { SnapshotManagementService } from "../../services/snapshotManagement.js";
import { testConfig } from "../../test/helpers/appFactory.js";

const PROJECT_ID = "6f35c2aa-fd34-4905-a370-7d9642244166";

describe("compile routes", () => {
  it("returns 200 with compile result on success", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    compileDispatchService.compile.mockResolvedValue({
      status: "success",
      logs: "Output written on main.pdf",
    });
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    const response = await request(app)
      .post(`/api/projects/${PROJECT_ID}/compile`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      status: "success",
      logs: "Output written on main.pdf",
    });
  });

  it("returns 200 with failure status on compile failure", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    compileDispatchService.compile.mockResolvedValue({
      status: "failure",
      logs: "! LaTeX Error",
    });
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    const response = await request(app)
      .post(`/api/projects/${PROJECT_ID}/compile`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.status).toBe("failure");
  });

  it("returns 409 when compile is already in progress", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    compileDispatchService.compile.mockRejectedValue(
      new CompileAlreadyInProgressError(),
    );
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/compile`)
      .set("authorization", `Bearer ${token}`)
      .expect(409)
      .expect({ error: "compile already in progress" });
  });

  it("returns 400 when no main document found", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    compileDispatchService.compile.mockRejectedValue(
      new CompileMainDocumentNotFoundError(),
    );
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/compile`)
      .set("authorization", `Bearer ${token}`)
      .expect(400)
      .expect({ error: "no main document found for this project" });
  });

  it("returns 404 when project not found", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    compileDispatchService.compile.mockRejectedValue(
      new ProjectNotFoundError(),
    );
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/compile`)
      .set("authorization", `Bearer ${token}`)
      .expect(404)
      .expect({ error: "project not found" });
  });

  it("returns 403 when role is insufficient", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    compileDispatchService.compile.mockRejectedValue(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    await request(app)
      .post(`/api/projects/${PROJECT_ID}/compile`)
      .set("authorization", `Bearer ${token}`)
      .expect(403)
      .expect({ error: "required project role missing" });
  });

  it("returns 400 for invalid projectId", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    const app = createCompileTestApp(compileDispatchService);
    const token = signToken("user-1", testConfig.jwtSecret);

    await request(app)
      .post("/api/projects/not-a-uuid/compile")
      .set("authorization", `Bearer ${token}`)
      .expect(400);
  });

  it("returns 401 without auth token", async () => {
    const compileDispatchService = createMockCompileDispatchService();
    const app = createCompileTestApp(compileDispatchService);

    await request(app).post(`/api/projects/${PROJECT_ID}/compile`).expect(401);
  });
});

function createMockCompileDispatchService() {
  return {
    compile: vi.fn<CompileDispatchService["compile"]>(),
  };
}

function createCompileTestApp(compileDispatchService: CompileDispatchService) {
  return createHttpApp(testConfig, {
    authService: createStubAuthService(),
    commentService: createStubCommentService(),
    compileDispatchService,
    documentService: createStubDocumentService(),
    membershipService: createStubMembershipService(),
    projectService: createStubProjectService(),
    snapshotManagementService: createStubSnapshotManagementService(),
  });
}

function createStubAuthService(): AuthService {
  return {
    register: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    login: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    getAuthenticatedUser: async () => {
      throw new Error("Not implemented for compile route tests");
    },
  };
}

function createStubCommentService(): CommentService {
  return {
    listThreads: async () => [],
    createThread: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    replyToThread: async () => {
      throw new Error("Not implemented for compile route tests");
    },
  };
}

function createStubDocumentService(): DocumentService {
  return {
    getTree: async () => [],
    createFile: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    moveNode: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    renameNode: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    deleteNode: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    getFileContent: async () => {
      throw new Error("Not implemented for compile route tests");
    },
  };
}

function createStubMembershipService(): MembershipService {
  return {
    listMembers: async () => [],
    addMember: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    updateMemberRole: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    deleteMember: async () => {
      throw new Error("Not implemented for compile route tests");
    },
  };
}

function createStubProjectService(): ProjectService {
  return {
    createProject: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    listProjects: async () => [],
    getProject: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    updateProject: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    deleteProject: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    getMainDocument: async () => {
      throw new Error("Not implemented for compile route tests");
    },
    setMainDocument: async () => {
      throw new Error("Not implemented for compile route tests");
    },
  };
}

function createStubSnapshotManagementService(): SnapshotManagementService {
  return {
    listSnapshots: async () => [],
    restoreSnapshot: async () => {
      throw new Error("Not implemented for compile route tests");
    },
  };
}
