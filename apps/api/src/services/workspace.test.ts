import { describe, expect, it, vi } from "vitest";
import type { CurrentTextStateService } from "./currentTextState.js";
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

describe("workspace service", () => {
  it("opens a text document for an authorized member from current state", async () => {
    const documentRepository = createDocumentRepository();
    const projectAccessService = createProjectAccessService();
    const currentTextStateService = createCurrentTextStateService();
    const service = createWorkspaceService({
      projectAccessService,
      documentRepository,
      currentTextStateService,
    });

    documentRepository.findById.mockResolvedValue(createStoredDocument());
    currentTextStateService.loadOrHydrate.mockResolvedValue(
      createStoredDocumentTextState({
        textContent: "\\section{Body}",
      }),
    );

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
    expect(currentTextStateService.loadOrHydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "document-1",
      }),
    );
  });

  it("returns null content for binary documents without hydrating text state", async () => {
    const documentRepository = createDocumentRepository();
    const currentTextStateService = createCurrentTextStateService();
    const service = createWorkspaceService({
      projectAccessService: createProjectAccessService(),
      documentRepository,
      currentTextStateService,
    });

    documentRepository.findById.mockResolvedValue(
      createStoredDocument({
        id: "binary-1",
        path: "/figure.png",
        kind: "binary",
        mime: "image/png",
      }),
    );

    await expect(
      service.openDocument({
        projectId: "project-1",
        documentId: "binary-1",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      content: null,
      document: {
        kind: "binary",
      },
    });
    expect(currentTextStateService.loadOrHydrate).not.toHaveBeenCalled();
  });

  it("maps missing membership to access denied", async () => {
    const projectAccessService = createProjectAccessService();
    projectAccessService.requireProjectMember.mockRejectedValue(
      new ProjectNotFoundError(),
    );
    const service = createWorkspaceService({
      projectAccessService,
      documentRepository: createDocumentRepository(),
      currentTextStateService: createCurrentTextStateService(),
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
      currentTextStateService: createCurrentTextStateService(),
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

function createCurrentTextStateService() {
  return {
    loadOrHydrate: vi.fn<CurrentTextStateService["loadOrHydrate"]>(),
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

function createStoredDocumentTextState(
  overrides: Partial<
    Awaited<ReturnType<CurrentTextStateService["loadOrHydrate"]>>
  > = {},
) {
  return {
    documentId: "document-1",
    yjsState: Uint8Array.from([]),
    textContent: "\\section{Default}",
    version: 1,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
