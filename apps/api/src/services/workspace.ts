import type { ProjectDocument } from "@collab-tex/shared";
import type { CurrentTextStateService } from "./currentTextState.js";
import type { DocumentRepository } from "./document.js";
import { serializeDocument } from "./document.js";
import {
  ProjectNotFoundError,
  type ProjectAccessService,
} from "./projectAccess.js";

export type WorkspaceOpenInput = {
  projectId: string;
  documentId: string;
  userId: string;
};

export type WorkspaceOpenedDocument = {
  projectId: string;
  document: ProjectDocument;
  content: string | null;
};

export type WorkspaceDocumentLookup = Pick<DocumentRepository, "findById">;

export type WorkspaceService = {
  openDocument: (input: WorkspaceOpenInput) => Promise<WorkspaceOpenedDocument>;
};

export class WorkspaceAccessDeniedError extends Error {
  constructor() {
    super("Project membership is required");
  }
}

export class WorkspaceDocumentNotFoundError extends Error {
  constructor() {
    super("Workspace document not found");
  }
}

export function createWorkspaceService({
  projectAccessService,
  documentRepository,
  currentTextStateService,
}: {
  projectAccessService: ProjectAccessService;
  documentRepository: WorkspaceDocumentLookup;
  currentTextStateService: Pick<CurrentTextStateService, "loadOrHydrate">;
}): WorkspaceService {
  return {
    openDocument: async ({ projectId, documentId, userId }) => {
      try {
        await projectAccessService.requireProjectMember(projectId, userId);
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new WorkspaceAccessDeniedError();
        }

        throw error;
      }

      const document = await documentRepository.findById(projectId, documentId);

      if (!document) {
        throw new WorkspaceDocumentNotFoundError();
      }

      return {
        projectId,
        document: serializeDocument(document),
        content:
          document.kind === "binary"
            ? null
            : (await currentTextStateService.loadOrHydrate(document))
                .textContent,
      };
    },
  };
}
