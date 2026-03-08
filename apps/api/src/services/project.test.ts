import { describe, expect, it, vi } from "vitest";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  createProjectService,
  type ProjectRepository,
  type StoredProject,
} from "./project.js";

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
    repository.findForUser.mockResolvedValue({
      project: createStoredProject(),
      myRole: "editor",
    });
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

    expect(repository.updateName).not.toHaveBeenCalled();
  });

  it("updates projects for admins with normalized names", async () => {
    const repository = createProjectRepository();
    repository.findForUser.mockResolvedValue({
      project: createStoredProject(),
      myRole: "admin",
    });
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

    expect(repository.updateName).toHaveBeenCalledWith("project-1", "Renamed");
    expect(result).toBe(updatedProject);
  });

  it("maps missing rows during delete to not found", async () => {
    const repository = createProjectRepository();
    repository.findForUser.mockResolvedValue({
      project: createStoredProject(),
      myRole: "admin",
    });
    repository.softDelete.mockResolvedValue(false);
    const service = createProjectService({
      projectRepository: repository,
    });

    await expect(
      service.deleteProject({
        projectId: "project-1",
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

function createProjectRepository() {
  return {
    createForOwner: vi.fn<ProjectRepository["createForOwner"]>(),
    listForUser: vi.fn<ProjectRepository["listForUser"]>(),
    findForUser: vi.fn<ProjectRepository["findForUser"]>(),
    updateName: vi.fn<ProjectRepository["updateName"]>(),
    softDelete: vi.fn<ProjectRepository["softDelete"]>(),
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
