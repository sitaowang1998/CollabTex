import { describe, expect, it, vi } from "vitest";
import {
  DocumentNotFoundError,
  InvalidDocumentPathError,
  buildFileTree,
  createDocumentService,
  type DocumentRepository,
  type StoredDocument,
} from "./document.js";
import {
  ProjectRoleRequiredError,
  type ProjectAccessService,
} from "./projectAccess.js";

describe("document service", () => {
  it("builds a nested file tree from absolute stored paths", () => {
    const tree = buildFileTree([
      createStoredDocument({
        id: "doc-2",
        path: "/docs/intro.tex",
      }),
      createStoredDocument({
        id: "doc-1",
        path: "/main.tex",
      }),
      createStoredDocument({
        id: "doc-3",
        path: "/docs/figures/plot.png",
        kind: "binary",
        mime: "image/png",
      }),
    ]);

    expect(tree).toEqual([
      {
        type: "folder",
        name: "docs",
        path: "/docs",
        children: [
          {
            type: "folder",
            name: "figures",
            path: "/docs/figures",
            children: [
              {
                type: "file",
                name: "plot.png",
                path: "/docs/figures/plot.png",
                documentId: "doc-3",
                documentKind: "binary",
                mime: "image/png",
              },
            ],
          },
          {
            type: "file",
            name: "intro.tex",
            path: "/docs/intro.tex",
            documentId: "doc-2",
            documentKind: "text",
            mime: null,
          },
        ],
      },
      {
        type: "file",
        name: "main.tex",
        path: "/main.tex",
        documentId: "doc-1",
        documentKind: "text",
        mime: null,
      },
    ]);
  });

  it("normalizes relative and absolute file paths before repository writes", async () => {
    const repository = createDocumentRepository();
    const service = createDocumentService({
      documentRepository: repository,
      projectAccessService: createProjectAccessService(),
    });

    repository.createDocument.mockResolvedValue(
      createStoredDocument({
        path: "/docs/main.tex",
      }),
    );

    await service.createFile({
      projectId: "project-1",
      actorUserId: "user-1",
      path: "  docs/main.tex  ",
      kind: "text",
      mime: " text/plain ",
    });
    await service.createFile({
      projectId: "project-1",
      actorUserId: "user-1",
      path: " /docs/appendix.tex ",
      kind: "text",
    });

    expect(repository.createDocument).toHaveBeenNthCalledWith(1, {
      projectId: "project-1",
      actorUserId: "user-1",
      path: "/docs/main.tex",
      kind: "text",
      mime: "text/plain",
    });
    expect(repository.createDocument).toHaveBeenNthCalledWith(2, {
      projectId: "project-1",
      actorUserId: "user-1",
      path: "/docs/appendix.tex",
      kind: "text",
      mime: null,
    });
  });

  it("rejects invalid paths and invalid rename targets", async () => {
    const service = createDocumentService({
      documentRepository: createDocumentRepository(),
      projectAccessService: createProjectAccessService(),
    });

    await expect(
      service.createFile({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "//main.tex",
        kind: "text",
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentPathError);
    await expect(
      service.renameNode({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "main.tex",
        name: "docs/next.tex",
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentPathError);
  });

  it("maps missing move, rename, delete, and content lookups to DocumentNotFoundError", async () => {
    const repository = createDocumentRepository();
    const service = createDocumentService({
      documentRepository: repository,
      projectAccessService: createProjectAccessService(),
    });

    repository.moveNode.mockResolvedValue(false);
    repository.deleteNode.mockResolvedValue(false);
    repository.findByPath.mockResolvedValue(null);

    await expect(
      service.moveNode({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "/docs/main.tex",
        destinationParentPath: "/archive",
      }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(
      service.renameNode({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "/docs/main.tex",
        name: "renamed.tex",
      }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(
      service.deleteNode({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "/docs/main.tex",
      }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(
      service.getFileContent({
        projectId: "project-1",
        userId: "user-1",
        path: "/docs/main.tex",
      }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it("passes root moves through as a null parent path and returns empty text content", async () => {
    const repository = createDocumentRepository();
    const service = createDocumentService({
      documentRepository: repository,
      projectAccessService: createProjectAccessService(),
    });

    repository.moveNode.mockResolvedValue(true);
    repository.findByPath.mockResolvedValue(
      createStoredDocument({
        path: "/main.tex",
      }),
    );

    await service.moveNode({
      projectId: "project-1",
      actorUserId: "user-1",
      path: "/docs/main.tex",
      destinationParentPath: null,
    });
    const response = await service.getFileContent({
      projectId: "project-1",
      userId: "user-1",
      path: "main.tex",
    });

    expect(repository.moveNode).toHaveBeenCalledWith({
      projectId: "project-1",
      actorUserId: "user-1",
      path: "/docs/main.tex",
      nextPath: "/main.tex",
    });
    expect(response).toEqual({
      document: {
        id: "document-1",
        path: "/main.tex",
        kind: "text",
        mime: null,
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
      },
      content: "",
    });
  });

  it("checks write access before file creation", async () => {
    const repository = createDocumentRepository();
    const projectAccessService = createProjectAccessService();
    projectAccessService.requireProjectRole.mockRejectedValue(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );
    const service = createDocumentService({
      documentRepository: repository,
      projectAccessService,
    });

    await expect(
      service.createFile({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "/docs/main.tex",
        kind: "text",
      }),
    ).rejects.toBeInstanceOf(ProjectRoleRequiredError);

    expect(repository.createDocument).not.toHaveBeenCalled();
  });
});

function createDocumentRepository() {
  return {
    listForProject: vi
      .fn<DocumentRepository["listForProject"]>()
      .mockResolvedValue([]),
    findByPath: vi.fn<DocumentRepository["findByPath"]>(),
    createDocument: vi.fn<DocumentRepository["createDocument"]>(),
    moveNode: vi.fn<DocumentRepository["moveNode"]>(),
    deleteNode: vi.fn<DocumentRepository["deleteNode"]>(),
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
    requireProjectRole: vi
      .fn<ProjectAccessService["requireProjectRole"]>()
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
