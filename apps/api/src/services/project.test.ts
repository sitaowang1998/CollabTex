import { describe, expect, it, vi } from "vitest";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  createProjectService,
  type DocumentLookup,
  type ProjectRepository,
  type StoredProject,
} from "./project.js";
import type { StoredDocument } from "./document.js";

describe("project service", () => {
  it("normalizes project names on create", async () => {
    const repository = createProjectRepository();
    const createdProject = createStoredProject();
    repository.createForOwner.mockResolvedValue(createdProject);
    const service = createProjectService({
      projectRepository: repository,
    });

    const result = await service.createProject({
      ownerUserId: "user-1",
      name: "  Thesis  ",
    });

    expect(repository.createForOwner).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Thesis",
    });
    expect(result).toBe(createdProject);
  });

  it("returns member-scoped lists from the repository", async () => {
    const repository = createProjectRepository();
    const projects = [
      {
        project: createStoredProject(),
        myRole: "admin" as const,
      },
    ];
    repository.listForUser.mockResolvedValue(projects);
    const service = createProjectService({
      projectRepository: repository,
    });

    await expect(service.listProjects("user-1")).resolves.toBe(projects);
  });

  it("rejects detail lookups for inaccessible projects", async () => {
    const repository = createProjectRepository();
    repository.findForUser.mockResolvedValue(null);
    const service = createProjectService({
      projectRepository: repository,
    });

    await expect(
      service.getProject("project-1", "user-1"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("rejects updates for non-admin members", async () => {
    const repository = createProjectRepository();
    repository.updateName.mockRejectedValue(new ProjectAdminRequiredError());
    const service = createProjectService({
      projectRepository: repository,
    });

    await expect(
      service.updateProject({
        projectId: "project-1",
        userId: "user-1",
        name: "Renamed",
      }),
    ).rejects.toBeInstanceOf(ProjectAdminRequiredError);

    expect(repository.updateName).toHaveBeenCalledWith({
      projectId: "project-1",
      actorUserId: "user-1",
      name: "Renamed",
    });
  });

  it("updates projects for admins with normalized names", async () => {
    const repository = createProjectRepository();
    const updatedProject = createStoredProject({
      name: "Renamed",
    });
    repository.updateName.mockResolvedValue(updatedProject);
    const service = createProjectService({
      projectRepository: repository,
    });

    const result = await service.updateProject({
      projectId: "project-1",
      userId: "user-1",
      name: "  Renamed  ",
    });

    expect(repository.updateName).toHaveBeenCalledWith({
      projectId: "project-1",
      actorUserId: "user-1",
      name: "Renamed",
    });
    expect(result).toBe(updatedProject);
  });

  it("maps missing rows during delete to not found", async () => {
    const repository = createProjectRepository();
    repository.softDelete.mockRejectedValue(new ProjectNotFoundError());
    const service = createProjectService({
      projectRepository: repository,
    });

    await expect(
      service.deleteProject({
        projectId: "project-1",
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);

    expect(repository.softDelete).toHaveBeenCalledWith({
      projectId: "project-1",
      actorUserId: "user-1",
      deletedAt: expect.any(Date),
    });
  });

  describe("getMainDocument", () => {
    it("returns explicit document when set", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      const doc = createStoredDocument();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      repository.getMainDocumentId.mockResolvedValue("doc-1");
      documentLookup.findById.mockResolvedValue(doc);
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      const result = await service.getMainDocument("project-1", "user-1");

      expect(result).toBe(doc);
      expect(documentLookup.findById).toHaveBeenCalledWith(
        "project-1",
        "doc-1",
      );
    });

    it("falls back to /main.tex when no explicit main document", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      const doc = createStoredDocument({ path: "/main.tex" });
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      repository.getMainDocumentId.mockResolvedValue(null);
      documentLookup.findByPath.mockResolvedValue(doc);
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      const result = await service.getMainDocument("project-1", "user-1");

      expect(result).toBe(doc);
      expect(documentLookup.findByPath).toHaveBeenCalledWith(
        "project-1",
        "/main.tex",
      );
    });

    it("returns null when neither explicit nor /main.tex exists", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      repository.getMainDocumentId.mockResolvedValue(null);
      documentLookup.findByPath.mockResolvedValue(null);
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      const result = await service.getMainDocument("project-1", "user-1");

      expect(result).toBeNull();
    });

    it("rejects non-members", async () => {
      const repository = createProjectRepository();
      repository.findForUser.mockResolvedValue(null);
      const service = createProjectService({
        projectRepository: repository,
      });

      await expect(
        service.getMainDocument("project-1", "user-1"),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });

  describe("setMainDocument", () => {
    it("rejects non-member", async () => {
      const repository = createProjectRepository();
      repository.findForUser.mockResolvedValue(null);
      const service = createProjectService({
        projectRepository: repository,
      });

      await expect(
        service.setMainDocument("project-1", "user-1", "doc-1"),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it("rejects reader role", async () => {
      const repository = createProjectRepository();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      const service = createProjectService({
        projectRepository: repository,
      });

      await expect(
        service.setMainDocument("project-1", "user-1", "doc-1"),
      ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
    });

    it("rejects commenter role", async () => {
      const repository = createProjectRepository();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "commenter",
      });
      const service = createProjectService({
        projectRepository: repository,
      });

      await expect(
        service.setMainDocument("project-1", "user-1", "doc-1"),
      ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
    });

    it("succeeds for editor", async () => {
      const repository = createProjectRepository();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "editor",
      });
      repository.setMainDocumentId.mockResolvedValue(undefined);
      const service = createProjectService({
        projectRepository: repository,
      });

      await service.setMainDocument("project-1", "user-1", "doc-1");

      expect(repository.setMainDocumentId).toHaveBeenCalledWith({
        projectId: "project-1",
        actorUserId: "user-1",
        documentId: "doc-1",
      });
    });

    it("succeeds for admin", async () => {
      const repository = createProjectRepository();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "admin",
      });
      repository.setMainDocumentId.mockResolvedValue(undefined);
      const service = createProjectService({
        projectRepository: repository,
      });

      await service.setMainDocument("project-1", "user-1", "doc-1");

      expect(repository.setMainDocumentId).toHaveBeenCalledWith({
        projectId: "project-1",
        actorUserId: "user-1",
        documentId: "doc-1",
      });
    });
  });
});

function createProjectRepository() {
  return {
    createForOwner: vi.fn<ProjectRepository["createForOwner"]>(),
    findActiveById: vi.fn<ProjectRepository["findActiveById"]>(),
    listForUser: vi.fn<ProjectRepository["listForUser"]>(),
    findForUser: vi.fn<ProjectRepository["findForUser"]>(),
    updateName: vi.fn<ProjectRepository["updateName"]>(),
    softDelete: vi.fn<ProjectRepository["softDelete"]>(),
    getMainDocumentId: vi.fn<ProjectRepository["getMainDocumentId"]>(),
    setMainDocumentId: vi.fn<ProjectRepository["setMainDocumentId"]>(),
  };
}

function createDocumentLookup() {
  return {
    findById: vi.fn<DocumentLookup["findById"]>(),
    findByPath: vi.fn<DocumentLookup["findByPath"]>(),
  };
}

function createStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id: "doc-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text",
    mime: "application/x-tex",
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createStoredProject(
  overrides: Partial<StoredProject> = {},
): StoredProject {
  return {
    id: "project-1",
    name: "Project One",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    tombstoneAt: null,
    ...overrides,
  };
}
