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

export type CreateProjectInput = {
  ownerUserId: string;
  name: string;
};

export type UpdateProjectInput = {
  projectId: string;
  userId: string;
  name: string;
};

export type DeleteProjectInput = {
  projectId: string;
  userId: string;
};

export type ProjectRepository = {
  createForOwner: (input: CreateProjectInput) => Promise<StoredProject>;
  listForUser: (userId: string) => Promise<ProjectWithRole[]>;
  findForUser: (
    projectId: string,
    userId: string,
  ) => Promise<ProjectWithRole | null>;
  updateName: (
    projectId: string,
    name: string,
  ) => Promise<StoredProject | null>;
  softDelete: (projectId: string, deletedAt: Date) => Promise<boolean>;
};

export type ProjectService = {
  createProject: (input: CreateProjectInput) => Promise<StoredProject>;
  listProjects: (userId: string) => Promise<ProjectWithRole[]>;
  getProject: (projectId: string, userId: string) => Promise<ProjectWithRole>;
  updateProject: (input: UpdateProjectInput) => Promise<StoredProject>;
  deleteProject: (input: DeleteProjectInput) => Promise<void>;
};

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
  }
}

export class ProjectAdminRequiredError extends Error {
  constructor() {
    super("Project admin role is required");
  }
}

export class ProjectOwnerNotFoundError extends Error {
  constructor() {
    super("Project owner user not found");
  }
}

export function createProjectService({
  projectRepository,
}: {
  projectRepository: ProjectRepository;
}): ProjectService {
  return {
    createProject: async (input) =>
      projectRepository.createForOwner({
        ownerUserId: input.ownerUserId,
        name: normalizeProjectName(input.name),
      }),
    listProjects: async (userId) => projectRepository.listForUser(userId),
    getProject: async (projectId, userId) => {
      const project = await projectRepository.findForUser(projectId, userId);

      if (!project) {
        throw new ProjectNotFoundError();
      }

      return project;
    },
    updateProject: async (input) => {
      const project = await requireProjectAdmin(
        projectRepository,
        input.projectId,
        input.userId,
      );
      const updatedProject = await projectRepository.updateName(
        project.project.id,
        normalizeProjectName(input.name),
      );

      if (!updatedProject) {
        throw new ProjectNotFoundError();
      }

      return updatedProject;
    },
    deleteProject: async (input) => {
      const project = await requireProjectAdmin(
        projectRepository,
        input.projectId,
        input.userId,
      );
      const deleted = await projectRepository.softDelete(
        project.project.id,
        new Date(),
      );

      if (!deleted) {
        throw new ProjectNotFoundError();
      }
    },
  };
}

async function requireProjectAdmin(
  projectRepository: ProjectRepository,
  projectId: string,
  userId: string,
): Promise<ProjectWithRole> {
  const project = await projectRepository.findForUser(projectId, userId);

  if (!project) {
    throw new ProjectNotFoundError();
  }

  if (project.myRole !== "admin") {
    throw new ProjectAdminRequiredError();
  }

  return project;
}

function normalizeProjectName(name: string): string {
  return name.trim();
}
