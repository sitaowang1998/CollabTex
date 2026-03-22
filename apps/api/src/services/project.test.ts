import { describe, expect, it, vi } from "vitest";
import {
  InvalidMainDocumentError,
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
      documentLookup: createDocumentLookup(),
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
      documentLookup: createDocumentLookup(),
    });

    await expect(service.listProjects("user-1")).resolves.toBe(projects);
  });

  it("rejects detail lookups for inaccessible projects", async () => {
    const repository = createProjectRepository();
    repository.findForUser.mockResolvedValue(null);
    const service = createProjectService({
      projectRepository: repository,
      documentLookup: createDocumentLookup(),
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
      documentLookup: createDocumentLookup(),
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
      documentLookup: createDocumentLookup(),
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
      documentLookup: createDocumentLookup(),
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

  describe("binary content cleanup on delete", () => {
    it("lists documents before soft-deleting the project", async () => {
      const callOrder: string[] = [];
      const repository = createProjectRepository();
      repository.softDelete.mockImplementation(async () => {
        callOrder.push("softDelete");
      });
      const documentListing = createDocumentListing();
      documentListing.listForProject.mockImplementation(async () => {
        callOrder.push("listForProject");
        return [];
      });
      const service = createProjectService({
        projectRepository: repository,
        documentListing,
        binaryContentStore: createBinaryContentStore(),
      });

      await service.deleteProject({ projectId: "project-1", userId: "user-1" });

      expect(callOrder).toEqual(["listForProject", "softDelete"]);
    });

    it("deletes binary content for binary documents after soft-delete", async () => {
      const repository = createProjectRepository();
      repository.softDelete.mockResolvedValue(undefined);
      const documentListing = createDocumentListing();
      const binaryContentStore = createBinaryContentStore();
      documentListing.listForProject.mockResolvedValue([
        createStoredDocument({ id: "text-doc", kind: "text" }),
        createStoredDocument({ id: "bin-1", kind: "binary", path: "/img.png" }),
        createStoredDocument({ id: "bin-2", kind: "binary", path: "/fig.pdf" }),
      ]);
      binaryContentStore.delete.mockResolvedValue(undefined);
      const service = createProjectService({
        projectRepository: repository,
        documentListing,
        binaryContentStore,
      });

      await service.deleteProject({ projectId: "project-1", userId: "user-1" });

      expect(binaryContentStore.delete).toHaveBeenCalledTimes(2);
      expect(binaryContentStore.delete).toHaveBeenCalledWith("project-1/bin-1");
      expect(binaryContentStore.delete).toHaveBeenCalledWith("project-1/bin-2");
    });

    it("skips binary cleanup when no binary documents exist", async () => {
      const repository = createProjectRepository();
      repository.softDelete.mockResolvedValue(undefined);
      const documentListing = createDocumentListing();
      const binaryContentStore = createBinaryContentStore();
      documentListing.listForProject.mockResolvedValue([
        createStoredDocument({ id: "text-doc", kind: "text" }),
      ]);
      const service = createProjectService({
        projectRepository: repository,
        documentListing,
        binaryContentStore,
      });

      await service.deleteProject({ projectId: "project-1", userId: "user-1" });

      expect(binaryContentStore.delete).not.toHaveBeenCalled();
    });

    it("continues successfully when binary cleanup fails", async () => {
      const repository = createProjectRepository();
      repository.softDelete.mockResolvedValue(undefined);
      const documentListing = createDocumentListing();
      const binaryContentStore = createBinaryContentStore();
      documentListing.listForProject.mockResolvedValue([
        createStoredDocument({ id: "bin-1", kind: "binary", path: "/img.png" }),
      ]);
      binaryContentStore.delete.mockRejectedValue(new Error("disk error"));
      const logger = { warn: vi.fn(), error: vi.fn() };
      const service = createProjectService({
        projectRepository: repository,
        documentListing,
        binaryContentStore,
        logger,
      });

      await expect(
        service.deleteProject({ projectId: "project-1", userId: "user-1" }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to clean up binary content"),
        expect.any(Error),
      );
    });

    it("skips binary cleanup when dependencies not provided", async () => {
      const repository = createProjectRepository();
      repository.softDelete.mockResolvedValue(undefined);
      const service = createProjectService({
        projectRepository: repository,
      });

      await expect(
        service.deleteProject({ projectId: "project-1", userId: "user-1" }),
      ).resolves.toBeUndefined();
    });

    it("still soft-deletes when document listing fails", async () => {
      const repository = createProjectRepository();
      repository.softDelete.mockResolvedValue(undefined);
      const documentListing = createDocumentListing();
      const binaryContentStore = createBinaryContentStore();
      documentListing.listForProject.mockRejectedValue(
        new Error("db connection lost"),
      );
      const logger = { warn: vi.fn(), error: vi.fn() };
      const service = createProjectService({
        projectRepository: repository,
        documentListing,
        binaryContentStore,
        logger,
      });

      await expect(
        service.deleteProject({ projectId: "project-1", userId: "user-1" }),
      ).resolves.toBeUndefined();

      expect(repository.softDelete).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to list documents for binary cleanup"),
        expect.any(Error),
      );
      expect(binaryContentStore.delete).not.toHaveBeenCalled();
    });

    it("continues deleting remaining files when one cleanup fails", async () => {
      const repository = createProjectRepository();
      repository.softDelete.mockResolvedValue(undefined);
      const documentListing = createDocumentListing();
      const binaryContentStore = createBinaryContentStore();
      documentListing.listForProject.mockResolvedValue([
        createStoredDocument({ id: "bin-1", kind: "binary", path: "/a.png" }),
        createStoredDocument({ id: "bin-2", kind: "binary", path: "/b.png" }),
        createStoredDocument({ id: "bin-3", kind: "binary", path: "/c.png" }),
      ]);
      binaryContentStore.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("disk error"))
        .mockResolvedValueOnce(undefined);
      const logger = { warn: vi.fn(), error: vi.fn() };
      const service = createProjectService({
        projectRepository: repository,
        documentListing,
        binaryContentStore,
        logger,
      });

      await expect(
        service.deleteProject({ projectId: "project-1", userId: "user-1" }),
      ).resolves.toBeUndefined();

      expect(binaryContentStore.delete).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledTimes(1);
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

    it("falls through to /main.tex fallback when explicit main document was deleted", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      const fallbackDoc = {
        id: "fallback-doc",
        path: "/main.tex",
        kind: "text" as const,
      };
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      repository.getMainDocumentId.mockResolvedValue("deleted-doc-id");
      documentLookup.findById.mockResolvedValue(null);
      documentLookup.findByPath.mockResolvedValue(fallbackDoc);
      const logger = { warn: vi.fn(), error: vi.fn() };
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
        logger,
      });

      const result = await service.getMainDocument("project-1", "user-1");

      expect(result).toEqual(fallbackDoc);
      expect(documentLookup.findByPath).toHaveBeenCalledWith(
        "project-1",
        "/main.tex",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Stale mainDocumentId"),
      );
    });

    it("falls through to fallback when explicit main document is not text", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      const binaryDoc = createStoredDocument({
        id: "binary-doc-id",
        kind: "binary",
      });
      const fallbackDoc = createStoredDocument({
        id: "fallback-doc-id",
        path: "/main.tex",
        kind: "text",
      });
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      repository.getMainDocumentId.mockResolvedValue("binary-doc-id");
      documentLookup.findById.mockResolvedValue(binaryDoc);
      documentLookup.findByPath.mockResolvedValue(fallbackDoc);
      const logger = { warn: vi.fn(), error: vi.fn() };
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
        logger,
      });

      const result = await service.getMainDocument("project-1", "user-1");

      expect(result).toEqual(fallbackDoc);
      expect(documentLookup.findByPath).toHaveBeenCalledWith(
        "project-1",
        "/main.tex",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("is not a text document"),
      );
    });

    it("returns null when /main.tex fallback is a binary document", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "reader",
      });
      repository.getMainDocumentId.mockResolvedValue(null);
      documentLookup.findByPath.mockResolvedValue(
        createStoredDocument({ kind: "binary", path: "/main.tex" }),
      );
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      const result = await service.getMainDocument("project-1", "user-1");

      expect(result).toBeNull();
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
        documentLookup: createDocumentLookup(),
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
        documentLookup: createDocumentLookup(),
      });

      await expect(
        service.setMainDocument({
          projectId: "project-1",
          userId: "user-1",
          documentId: "doc-1",
        }),
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
        documentLookup: createDocumentLookup(),
      });

      await expect(
        service.setMainDocument({
          projectId: "project-1",
          userId: "user-1",
          documentId: "doc-1",
        }),
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
        documentLookup: createDocumentLookup(),
      });

      await expect(
        service.setMainDocument({
          projectId: "project-1",
          userId: "user-1",
          documentId: "doc-1",
        }),
      ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
    });

    it("rejects document not found in project", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "editor",
      });
      documentLookup.findById.mockResolvedValue(null);
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      await expect(
        service.setMainDocument({
          projectId: "project-1",
          userId: "user-1",
          documentId: "doc-1",
        }),
      ).rejects.toBeInstanceOf(InvalidMainDocumentError);
      expect(repository.setMainDocumentId).not.toHaveBeenCalled();
    });

    it("rejects binary document", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "editor",
      });
      documentLookup.findById.mockResolvedValue(
        createStoredDocument({ kind: "binary", path: "/image.png" }),
      );
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      await expect(
        service.setMainDocument({
          projectId: "project-1",
          userId: "user-1",
          documentId: "doc-1",
        }),
      ).rejects.toBeInstanceOf(InvalidMainDocumentError);
      expect(repository.setMainDocumentId).not.toHaveBeenCalled();
    });

    it("succeeds for editor with valid text document", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "editor",
      });
      documentLookup.findById.mockResolvedValue(createStoredDocument());
      repository.setMainDocumentId.mockResolvedValue(undefined);
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      await service.setMainDocument({
        projectId: "project-1",
        userId: "user-1",
        documentId: "doc-1",
      });

      expect(repository.setMainDocumentId).toHaveBeenCalledWith({
        projectId: "project-1",
        documentId: "doc-1",
      });
    });

    it("succeeds for admin with valid text document", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "admin",
      });
      documentLookup.findById.mockResolvedValue(createStoredDocument());
      repository.setMainDocumentId.mockResolvedValue(undefined);
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      await service.setMainDocument({
        projectId: "project-1",
        userId: "user-1",
        documentId: "doc-1",
      });

      expect(repository.setMainDocumentId).toHaveBeenCalledWith({
        projectId: "project-1",
        documentId: "doc-1",
      });
    });

    it("propagates InvalidMainDocumentError from repository", async () => {
      const repository = createProjectRepository();
      const documentLookup = createDocumentLookup();
      repository.findForUser.mockResolvedValue({
        project: createStoredProject(),
        myRole: "editor",
      });
      documentLookup.findById.mockResolvedValue(createStoredDocument());
      repository.setMainDocumentId.mockRejectedValue(
        new InvalidMainDocumentError(
          "document is already the main document of another project",
        ),
      );
      const service = createProjectService({
        projectRepository: repository,
        documentLookup,
      });

      await expect(
        service.setMainDocument({
          projectId: "project-1",
          userId: "user-1",
          documentId: "doc-1",
        }),
      ).rejects.toBeInstanceOf(InvalidMainDocumentError);
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

function createDocumentListing() {
  return {
    listForProject: vi.fn<(projectId: string) => Promise<StoredDocument[]>>(),
  };
}

function createBinaryContentStore() {
  return {
    delete: vi.fn<(storagePath: string) => Promise<void>>(),
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
