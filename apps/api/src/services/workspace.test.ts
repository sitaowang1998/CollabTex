import { describe, expect, it, vi } from "vitest";
import type { DocumentRepository, StoredDocument } from "./document.js";
import {
  ProjectNotFoundError,
  type ProjectAccessService,
} from "./projectAccess.js";
import {
  createWorkspaceService,
  WorkspaceAccessDeniedError,
  WorkspaceDocumentNotFoundError,
} from "./workspace.js";
import type { SnapshotService } from "./snapshot.js";

describe("workspace service", () => {
  it("opens a document for an authorized member", async () => {
    const documentRepository = createDocumentRepository();
    const projectAccessService = createProjectAccessService();
    const snapshotService = createSnapshotService();
    const service = createWorkspaceService({
      projectAccessService,
      documentRepository,
      snapshotService,
    });

    documentRepository.findById.mockResolvedValue(createStoredDocument());
    snapshotService.loadDocumentContent.mockResolvedValue("\\section{Body}");

    await expect(
      service.openDocument({
        projectId: "project-1",
        documentId: "document-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      projectId: "project-1",
      document: {
        id: "document-1",
        path: "/main.tex",
        kind: "text",
        mime: null,
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
      content: "\\section{Body}",
    });
  });

  it("maps missing membership to access denied", async () => {
    const projectAccessService = createProjectAccessService();
    projectAccessService.requireProjectMember.mockRejectedValue(
      new ProjectNotFoundError(),
    );
    const service = createWorkspaceService({
      projectAccessService,
      documentRepository: createDocumentRepository(),
      snapshotService: createSnapshotService(),
    });

    await expect(
      service.openDocument({
        projectId: "project-1",
        documentId: "document-1",
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("maps missing documents to not found after membership succeeds", async () => {
    const service = createWorkspaceService({
      projectAccessService: createProjectAccessService(),
      documentRepository: createDocumentRepository(),
      snapshotService: createSnapshotService(),
    });

    await expect(
      service.openDocument({
        projectId: "project-1",
        documentId: "document-1",
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(WorkspaceDocumentNotFoundError);
  });
});

function createDocumentRepository() {
  return {
    findById: vi.fn<DocumentRepository["findById"]>(),
  };
}

function createProjectAccessService() {
  return {
    requireProjectMember: vi
      .fn<ProjectAccessService["requireProjectMember"]>()
      .mockResolvedValue({
        project: {
          id: "project-1",
          name: "Project",
          createdAt: new Date("2026-03-01T12:00:00.000Z"),
          updatedAt: new Date("2026-03-01T12:00:00.000Z"),
          tombstoneAt: null,
        },
        myRole: "admin",
      }),
    requireProjectRole: vi.fn<ProjectAccessService["requireProjectRole"]>(),
  };
}

function createSnapshotService() {
  return {
    loadDocumentContent: vi.fn<SnapshotService["loadDocumentContent"]>(),
    captureProjectSnapshot: vi.fn<SnapshotService["captureProjectSnapshot"]>(),
    listProjectSnapshots: vi.fn<SnapshotService["listProjectSnapshots"]>(),
    restoreProjectSnapshot: vi.fn<SnapshotService["restoreProjectSnapshot"]>(),
  };
}

function createStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text",
    mime: null,
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
