import {
  createProjectAccessService,
  type ProjectAccessRepository,
  type ProjectAccessService,
  type ProjectWithRole,
  type StoredProject,
} from "./projectAccess.js";
import { DOCUMENT_WRITE_ROLES, type StoredDocument } from "./document.js";

export type DocumentLookup = {
  findById: (
    projectId: string,
    documentId: string,
  ) => Promise<StoredDocument | null>;
  findByPath: (
    projectId: string,
    path: string,
  ) => Promise<StoredDocument | null>;
};

export {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
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
  findActiveById: (projectId: string) => Promise<StoredProject | null>;
  listForUser: (userId: string) => Promise<ProjectWithRole[]>;
  findForUser: (
    projectId: string,
    userId: string,
  ) => Promise<ProjectWithRole | null>;
  updateName: (input: {
    projectId: string;
    actorUserId: string;
    name: string;
  }) => Promise<StoredProject>;
  softDelete: (input: {
    projectId: string;
    actorUserId: string;
    deletedAt: Date;
  }) => Promise<void>;
  getMainDocumentId: (projectId: string) => Promise<string | null>;
  setMainDocumentId: (input: {
    projectId: string;
    documentId: string;
  }) => Promise<void>;
};

export type SetMainDocumentInput = {
  projectId: string;
  userId: string;
  documentId: string;
};

export type ProjectService = {
  createProject: (input: CreateProjectInput) => Promise<StoredProject>;
  listProjects: (userId: string) => Promise<ProjectWithRole[]>;
  getProject: (projectId: string, userId: string) => Promise<ProjectWithRole>;
  updateProject: (input: UpdateProjectInput) => Promise<StoredProject>;
  deleteProject: (input: DeleteProjectInput) => Promise<void>;
  getMainDocument: (
    projectId: string,
    userId: string,
  ) => Promise<StoredDocument | null>;
  setMainDocument: (input: SetMainDocumentInput) => Promise<void>;
};

export class ProjectOwnerNotFoundError extends Error {
  constructor() {
    super("Project owner user not found");
  }
}

export class InvalidMainDocumentError extends Error {
  constructor(reason: string) {
    super(`Invalid main document: ${reason}`);
  }
}

export function createProjectService({
  projectRepository,
  documentLookup = {
    findById: async () => null,
    findByPath: async () => null,
  },
  projectAccessService = createProjectAccessService({
    projectRepository: projectRepository as ProjectAccessRepository,
  }),
  logger = console,
}: {
  projectRepository: ProjectRepository;
  documentLookup?: DocumentLookup;
  projectAccessService?: ProjectAccessService;
  logger?: { warn: (message: string) => void };
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
      return projectRepository.updateName({
        projectId: input.projectId,
        actorUserId: input.userId,
        name: normalizeProjectName(input.name),
      });
    },
    deleteProject: async (input) => {
      await projectRepository.softDelete({
        projectId: input.projectId,
        actorUserId: input.userId,
        deletedAt: new Date(),
      });
    },
    getMainDocument: async (projectId, userId) => {
      await projectAccessService.requireProjectMember(projectId, userId);

      const mainDocumentId =
        await projectRepository.getMainDocumentId(projectId);

      if (mainDocumentId) {
        const doc = await documentLookup.findById(projectId, mainDocumentId);
        if (!doc) {
          logger.warn(
            `Stale mainDocumentId ${mainDocumentId} on project ${projectId}: document not found`,
          );
        } else if (doc.kind !== "text") {
          logger.warn(
            `mainDocumentId ${mainDocumentId} on project ${projectId} is not a text document`,
          );
        } else {
          return doc;
        }
      }

      const fallback = await documentLookup.findByPath(projectId, "/main.tex");
      if (fallback && fallback.kind !== "text") {
        return null;
      }
      return fallback;
    },
    setMainDocument: async ({ projectId, userId, documentId }) => {
      await projectAccessService.requireProjectRole(
        projectId,
        userId,
        DOCUMENT_WRITE_ROLES,
      );

      const doc = await documentLookup.findById(projectId, documentId);
      if (!doc) {
        throw new InvalidMainDocumentError("document not found in project");
      }
      if (doc.kind !== "text") {
        throw new InvalidMainDocumentError("main document must be a text file");
      }

      await projectRepository.setMainDocumentId({
        projectId,
        documentId,
      });
    },
  };
}

function normalizeProjectName(name: string): string {
  return name.trim();
}
