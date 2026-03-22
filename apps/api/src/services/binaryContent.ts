import { type ProjectAccessService } from "./projectAccess.js";
import {
  DOCUMENT_WRITE_ROLES,
  DocumentNotFoundError,
  type DocumentRepository,
} from "./document.js";

export type BinaryContentStore = {
  put(storagePath: string, content: Buffer): Promise<void>;
  get(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
};

export class BinaryContentNotFoundError extends Error {
  constructor() {
    super("Binary content not found");
    this.name = "BinaryContentNotFoundError";
  }
}

export class BinaryContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinaryContentValidationError";
  }
}

export type BinaryContentService = {
  uploadContent(input: {
    projectId: string;
    actorUserId: string;
    fileId: string;
    content: Buffer;
  }): Promise<void>;
  downloadContent(input: {
    projectId: string;
    actorUserId: string;
    fileId: string;
  }): Promise<Buffer>;
};

export function createBinaryContentService({
  projectAccessService,
  documentRepository,
  binaryContentStore,
}: {
  projectAccessService: ProjectAccessService;
  documentRepository: DocumentRepository;
  binaryContentStore: BinaryContentStore;
}): BinaryContentService {
  return {
    uploadContent: async ({ projectId, actorUserId, fileId, content }) => {
      await projectAccessService.requireProjectRole(
        projectId,
        actorUserId,
        DOCUMENT_WRITE_ROLES,
      );

      const document = await documentRepository.findById(projectId, fileId);

      if (!document) {
        throw new DocumentNotFoundError();
      }

      if (document.kind !== "binary") {
        throw new BinaryContentValidationError(
          "content upload is only allowed for binary documents",
        );
      }

      const storagePath = `${projectId}/${fileId}`;
      await binaryContentStore.put(storagePath, content);
    },

    downloadContent: async ({ projectId, actorUserId, fileId }) => {
      await projectAccessService.requireProjectMember(projectId, actorUserId);

      const document = await documentRepository.findById(projectId, fileId);

      if (!document) {
        throw new DocumentNotFoundError();
      }

      if (document.kind !== "binary") {
        throw new BinaryContentValidationError(
          "content download is only allowed for binary documents",
        );
      }

      const storagePath = `${projectId}/${fileId}`;
      return binaryContentStore.get(storagePath);
    },
  };
}
