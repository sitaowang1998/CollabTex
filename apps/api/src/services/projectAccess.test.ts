import { describe, expect, it, vi } from "vitest";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  createProjectAccessService,
  type ProjectAccessRepository,
  type ProjectWithRole,
} from "./projectAccess.js";

describe("project access service", () => {
  it("requires membership for member-scoped access", async () => {
    const projectRepository = createProjectAccessRepository();
    projectRepository.findForUser.mockResolvedValue(null);
    const service = createProjectAccessService({ projectRepository });

    await expect(
      service.requireProjectMember("project-1", "user-1"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("requires an allowed role for role-scoped access", async () => {
    const projectRepository = createProjectAccessRepository();
    projectRepository.findForUser.mockResolvedValue(
      createProjectWithRole("editor"),
    );
    const service = createProjectAccessService({ projectRepository });

    await expect(
      service.requireProjectRole("project-1", "user-1", ["admin"]),
    ).rejects.toBeInstanceOf(ProjectAdminRequiredError);
  });

  it("returns the project when the caller has an allowed role", async () => {
    const projectRepository = createProjectAccessRepository();
    const project = createProjectWithRole("commenter");
    projectRepository.findForUser.mockResolvedValue(project);
    const service = createProjectAccessService({ projectRepository });

    await expect(
      service.requireProjectRole("project-1", "user-1", ["commenter", "admin"]),
    ).resolves.toBe(project);
  });
});

function createProjectAccessRepository() {
  return {
    findForUser: vi.fn<ProjectAccessRepository["findForUser"]>(),
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
