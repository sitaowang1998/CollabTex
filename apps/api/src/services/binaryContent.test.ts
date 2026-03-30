import { describe, expect, it, vi } from "vitest";
import {
  BinaryContentNotFoundError,
  BinaryContentValidationError,
  createBinaryContentService,
  type BinaryContentStore,
} from "./binaryContent.js";
import {
  DocumentNotFoundError,
  type DocumentRepository,
  type DocumentService,
} from "./document.js";
import { ProjectNotFoundError, ProjectRoleRequiredError } from "./project.js";
import type { ProjectAccessService } from "./projectAccess.js";

function createMockProjectAccessService(): {
  [K in keyof ProjectAccessService]: ReturnType<typeof vi.fn>;
} {
  return {
    requireProjectMember: vi.fn().mockResolvedValue(undefined),
    requireProjectRole: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDocumentRepository(): {
  [K in keyof DocumentRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    listForProject: vi.fn(),
    findById: vi.fn(),
    findByPath: vi.fn(),
    createDocument: vi.fn(),
    moveNode: vi.fn(),
    deleteNode: vi.fn(),
  };
}

function createMockBinaryContentStore(): {
  [K in keyof BinaryContentStore]: ReturnType<typeof vi.fn>;
} {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockDocumentService(): {
  [K in keyof Pick<DocumentService, "createFile" | "deleteNode">]: ReturnType<
    typeof vi.fn
  >;
} {
  return {
    createFile: vi.fn(),
    deleteNode: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockQueueProjectSnapshot() {
  return vi.fn().mockResolvedValue(undefined);
}

const PROJECT_ID = "6f35c2aa-fd34-4905-a370-7d9642244166";
const USER_ID = "user-1";
const FILE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function createBinaryDocument() {
  return {
    id: FILE_ID,
    projectId: PROJECT_ID,
    path: "/images/logo.png",
    kind: "binary" as const,
    mime: "image/png",
    contentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("binaryContentService", () => {
  describe("uploadContent", () => {
    it("stores content for a binary document", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue(createBinaryDocument());

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      const content = Buffer.from("png data");
      await service.uploadContent({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        fileId: FILE_ID,
        content,
      });

      expect(projectAccessService.requireProjectRole).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
        ["admin", "editor"],
      );
      expect(documentRepository.findById).toHaveBeenCalledWith(
        PROJECT_ID,
        FILE_ID,
      );
      expect(binaryContentStore.put).toHaveBeenCalledWith(
        `${PROJECT_ID}/${FILE_ID}`,
        content,
      );
    });

    it("rejects when the user lacks the required role", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      projectAccessService.requireProjectRole.mockRejectedValue(
        new ProjectRoleRequiredError(["admin", "editor"]),
      );

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.uploadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
          content: Buffer.from("data"),
        }),
      ).rejects.toThrow(ProjectRoleRequiredError);

      expect(binaryContentStore.put).not.toHaveBeenCalled();
    });

    it("rejects when the project is not found", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      projectAccessService.requireProjectRole.mockRejectedValue(
        new ProjectNotFoundError(),
      );

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.uploadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
          content: Buffer.from("data"),
        }),
      ).rejects.toThrow(ProjectNotFoundError);
    });

    it("rejects when the document is not found", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue(null);

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.uploadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
          content: Buffer.from("data"),
        }),
      ).rejects.toThrow(DocumentNotFoundError);

      expect(binaryContentStore.put).not.toHaveBeenCalled();
    });

    it("rejects upload for a text document", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue({
        ...createBinaryDocument(),
        kind: "text",
      });

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.uploadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
          content: Buffer.from("data"),
        }),
      ).rejects.toThrow(BinaryContentValidationError);

      expect(binaryContentStore.put).not.toHaveBeenCalled();
    });

    it("queues snapshot after successful binary content upload", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      const queueProjectSnapshot = vi.fn().mockResolvedValue(undefined);
      documentRepository.findById.mockResolvedValue(createBinaryDocument());

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot,
      });

      await service.uploadContent({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        fileId: FILE_ID,
        content: Buffer.from("png data"),
      });

      expect(queueProjectSnapshot).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    });

    it("does not queue snapshot if binary content upload fails", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      const queueProjectSnapshot = vi.fn().mockResolvedValue(undefined);
      documentRepository.findById.mockResolvedValue(createBinaryDocument());
      binaryContentStore.put.mockRejectedValue(new Error("storage failure"));

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot,
      });

      await expect(
        service.uploadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
          content: Buffer.from("png data"),
        }),
      ).rejects.toThrow("storage failure");

      expect(queueProjectSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("downloadContent", () => {
    it("returns content for a binary document", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue(createBinaryDocument());
      const fileContent = Buffer.from("png data");
      binaryContentStore.get.mockResolvedValue(fileContent);

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      const result = await service.downloadContent({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        fileId: FILE_ID,
      });

      expect(result).toBe(fileContent);
      expect(projectAccessService.requireProjectMember).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
      );
      expect(documentRepository.findById).toHaveBeenCalledWith(
        PROJECT_ID,
        FILE_ID,
      );
      expect(binaryContentStore.get).toHaveBeenCalledWith(
        `${PROJECT_ID}/${FILE_ID}`,
      );
    });

    it("rejects when the project is not found", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      projectAccessService.requireProjectMember.mockRejectedValue(
        new ProjectNotFoundError(),
      );

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.downloadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
        }),
      ).rejects.toThrow(ProjectNotFoundError);
    });

    it("rejects when the document is not found", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue(null);

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.downloadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
        }),
      ).rejects.toThrow(DocumentNotFoundError);

      expect(binaryContentStore.get).not.toHaveBeenCalled();
    });

    it("rejects download for a text document", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue({
        ...createBinaryDocument(),
        kind: "text",
      });

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.downloadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
        }),
      ).rejects.toThrow(BinaryContentValidationError);

      expect(binaryContentStore.get).not.toHaveBeenCalled();
    });

    it("throws when binary content is not found in store", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const binaryContentStore = createMockBinaryContentStore();
      documentRepository.findById.mockResolvedValue(createBinaryDocument());
      binaryContentStore.get.mockRejectedValue(
        new BinaryContentNotFoundError(),
      );

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService: createMockDocumentService(),
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.downloadContent({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          fileId: FILE_ID,
        }),
      ).rejects.toThrow(BinaryContentNotFoundError);
    });
  });

  describe("createBinaryFile", () => {
    it("creates document and stores content atomically", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const documentService = createMockDocumentService();
      const binaryContentStore = createMockBinaryContentStore();
      const queueProjectSnapshot = createMockQueueProjectSnapshot();
      const createdDoc = createBinaryDocument();
      documentService.createFile.mockResolvedValue(createdDoc);

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService,
        binaryContentStore,
        queueProjectSnapshot,
      });

      const content = Buffer.from("png data");
      const result = await service.createBinaryFile({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        path: "/images/logo.png",
        mime: "image/png",
        content,
      });

      expect(result).toBe(createdDoc);
      expect(documentService.createFile).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        path: "/images/logo.png",
        kind: "binary",
        mime: "image/png",
      });
      expect(binaryContentStore.put).toHaveBeenCalledWith(
        `${PROJECT_ID}/${FILE_ID}`,
        content,
      );
      expect(queueProjectSnapshot).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    });

    it("cleans up document when storage fails", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const documentService = createMockDocumentService();
      const binaryContentStore = createMockBinaryContentStore();
      const createdDoc = createBinaryDocument();
      documentService.createFile.mockResolvedValue(createdDoc);
      binaryContentStore.put.mockRejectedValue(new Error("storage failure"));

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService,
        binaryContentStore,
        queueProjectSnapshot: createMockQueueProjectSnapshot(),
      });

      await expect(
        service.createBinaryFile({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          path: "/images/logo.png",
          mime: "image/png",
          content: Buffer.from("data"),
        }),
      ).rejects.toThrow("storage failure");

      expect(documentService.deleteNode).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        path: createdDoc.path,
      });
    });

    it("does not queue snapshot when storage fails", async () => {
      const projectAccessService = createMockProjectAccessService();
      const documentRepository = createMockDocumentRepository();
      const documentService = createMockDocumentService();
      const binaryContentStore = createMockBinaryContentStore();
      const queueProjectSnapshot = createMockQueueProjectSnapshot();
      documentService.createFile.mockResolvedValue(createBinaryDocument());
      binaryContentStore.put.mockRejectedValue(new Error("storage failure"));

      const service = createBinaryContentService({
        projectAccessService,
        documentRepository,
        documentService,
        binaryContentStore,
        queueProjectSnapshot,
      });

      await expect(
        service.createBinaryFile({
          projectId: PROJECT_ID,
          actorUserId: USER_ID,
          path: "/images/logo.png",
          mime: "image/png",
          content: Buffer.from("data"),
        }),
      ).rejects.toThrow("storage failure");

      expect(queueProjectSnapshot).not.toHaveBeenCalled();
    });
  });
});
