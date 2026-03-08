import {
  createProjectAccessService,
  ProjectNotFoundError,
  type ProjectAccessRepository,
  type ProjectAccessService,
  type ProjectWithRole,
  type StoredProject,
} from "./projectAccess.js";

export {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  type ProjectWithRole,
  type StoredProject,
} from "./projectAccess.js";

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

export class ProjectOwnerNotFoundError extends Error {
  constructor() {
    super("Project owner user not found");
  }
}

export function createProjectService({
  projectRepository,
  projectAccessService = createProjectAccessService({
    projectRepository: projectRepository as ProjectAccessRepository,
  }),
}: {
  projectRepository: ProjectRepository;
  projectAccessService?: ProjectAccessService;
}): ProjectService {
  return {
    createProject: async (input) =>
      projectRepository.createForOwner({
        ownerUserId: input.ownerUserId,
        name: normalizeProjectName(input.name),
      }),
    listProjects: async (userId) => projectRepository.listForUser(userId),
    getProject: async (projectId, userId) => {
      return projectAccessService.requireProjectMember(projectId, userId);
    },
    updateProject: async (input) => {
      const project = await projectAccessService.requireProjectRole(
        input.projectId,
        input.userId,
        ["admin"],
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
      const project = await projectAccessService.requireProjectRole(
        input.projectId,
        input.userId,
        ["admin"],
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

function normalizeProjectName(name: string): string {
  return name.trim();
}
