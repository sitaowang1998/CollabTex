import type { ProjectRole } from "@collab-tex/shared";

export type StoredProject = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  tombstoneAt: Date | null;
};

export type ProjectWithRole = {
  project: StoredProject;
  myRole: ProjectRole;
};

export type ProjectAccessRepository = {
  findForUser: (
    projectId: string,
    userId: string,
  ) => Promise<ProjectWithRole | null>;
};

export type ProjectAccessService = {
  requireProjectMember: (
    projectId: string,
    userId: string,
  ) => Promise<ProjectWithRole>;
  requireProjectRole: (
    projectId: string,
    userId: string,
    allowedRoles: readonly ProjectRole[],
  ) => Promise<ProjectWithRole>;
};

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
  }
}

export class ProjectRoleRequiredError extends Error {
  readonly allowedRoles: readonly ProjectRole[];

  constructor(allowedRoles: readonly ProjectRole[]) {
    super(`One of project roles is required: ${allowedRoles.join(", ")}`);
    this.allowedRoles = allowedRoles;
  }
}

export class ProjectAdminRequiredError extends ProjectRoleRequiredError {
  constructor() {
    super(["admin"]);
    this.message = "Project admin role is required";
  }
}

export function createProjectAccessService({
  projectRepository,
}: {
  projectRepository: ProjectAccessRepository;
}): ProjectAccessService {
  return {
    requireProjectMember: async (projectId, userId) => {
      const project = await projectRepository.findForUser(projectId, userId);

      if (!project) {
        throw new ProjectNotFoundError();
      }

      return project;
    },
    requireProjectRole: async (projectId, userId, allowedRoles) => {
      const project = await projectRepository.findForUser(projectId, userId);

      if (!project) {
        throw new ProjectNotFoundError();
      }

      if (allowedRoles.includes(project.myRole)) {
        return project;
      }

      if (allowedRoles.length === 1 && allowedRoles[0] === "admin") {
        throw new ProjectAdminRequiredError();
      }

      throw new ProjectRoleRequiredError(allowedRoles);
    },
  };
}
