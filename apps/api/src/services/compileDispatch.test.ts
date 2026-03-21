import { describe, expect, it, vi } from "vitest";
import type { CompileDoneEvent } from "@collab-tex/shared";
import type {
  CompileAdapter,
  CompileArtifactStore,
  CompileResult,
} from "./compile.js";
import type { ProjectAccessService } from "./projectAccess.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "./projectAccess.js";
import type { ProjectService } from "./project.js";
import type { CompileBuildRepository } from "../repositories/compileBuildRepository.js";
import { BinaryContentNotFoundError } from "./binaryContent.js";
import type { FileAssemblyDependencies } from "./workspaceExport.js";
import {
  CompileAlreadyInProgressError,
  CompileMainDocumentNotFoundError,
  createCompileDispatchService,
} from "./compileDispatch.js";

describe("compile dispatch service", () => {
  it("runs a successful compile and stores the PDF artifact", async () => {
    const {
      service,
      compileAdapter,
      compileArtifactStore,
      compileBuildRepository,
      notifyCompileDone,
    } = createTestService();

    const pdfContent = Buffer.from("%PDF-1.4 test");
    compileAdapter.compile.mockResolvedValue({
      outcome: "completed",
      exitCode: 0,
      logs: "Output written on main.pdf",
      pdfContent,
    });

    const result = await service.compile("project-1", "user-1");

    expect(result.status).toBe("success");
    expect(result.logs).toContain("Output written on main.pdf");
    expect(compileArtifactStore.writePdf).toHaveBeenCalledWith(
      expect.stringContaining("project-1/"),
      pdfContent,
    );
    expect(compileBuildRepository.saveLatestBuildPath).toHaveBeenCalledWith(
      "project-1",
      expect.stringContaining("project-1/"),
    );
    expect(notifyCompileDone).toHaveBeenCalledWith({
      projectId: "project-1",
      status: "success",
      logs: expect.any(String),
    });
  });

  it("returns failure when compile exits with non-zero code", async () => {
    const {
      service,
      compileArtifactStore,
      compileBuildRepository,
      notifyCompileDone,
    } = createTestService();

    const result = await service.compile("project-1", "user-1");

    expect(result.status).toBe("failure");
    expect(compileArtifactStore.writePdf).not.toHaveBeenCalled();
    expect(compileBuildRepository.saveLatestBuildPath).not.toHaveBeenCalled();
    expect(notifyCompileDone).toHaveBeenCalledWith({
      projectId: "project-1",
      status: "failure",
      logs: expect.any(String),
    });
  });

  it("returns failure on compile timeout", async () => {
    const { service, compileAdapter } = createTestService();
    compileAdapter.compile.mockResolvedValue({
      outcome: "timeout",
      logs: "timed out",
    });

    const result = await service.compile("project-1", "user-1");

    expect(result.status).toBe("failure");
    expect(result.logs).toContain("timed out");
  });

  it("rejects concurrent compiles for the same project", async () => {
    const { service, compileAdapter } = createTestService();

    let resolveCompile!: (value: CompileResult) => void;
    compileAdapter.compile.mockReturnValue(
      new Promise((resolve) => {
        resolveCompile = resolve;
      }),
    );

    const first = service.compile("project-1", "user-1");

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      CompileAlreadyInProgressError,
    );

    resolveCompile({
      outcome: "completed",
      exitCode: 1,
      logs: "",
    });
    await first;
  });

  it("allows compiles for different projects concurrently", async () => {
    const { service, compileAdapter } = createTestService();
    compileAdapter.compile.mockResolvedValue({
      outcome: "completed",
      exitCode: 1,
      logs: "",
    });

    const [r1, r2] = await Promise.all([
      service.compile("project-1", "user-1"),
      service.compile("project-2", "user-1"),
    ]);

    expect(r1.status).toBe("failure");
    expect(r2.status).toBe("failure");
  });

  it("releases the concurrency guard after an error", async () => {
    const { service, projectService } = createTestService();
    projectService.getMainDocument.mockResolvedValueOnce(null);

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      CompileMainDocumentNotFoundError,
    );

    // Should be able to compile again after the error
    projectService.getMainDocument.mockResolvedValueOnce(
      createStoredDocument(),
    );
    const result = await service.compile("project-1", "user-1");
    expect(result.status).toBe("failure");
  });

  it("throws CompileMainDocumentNotFoundError when no main doc", async () => {
    const { service, projectService } = createTestService();
    projectService.getMainDocument.mockResolvedValue(null);

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      CompileMainDocumentNotFoundError,
    );
  });

  it("propagates access errors from requireProjectRole", async () => {
    const { service, projectAccessService } = createTestService();
    projectAccessService.requireProjectRole.mockRejectedValue(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      ProjectRoleRequiredError,
    );
  });

  it("propagates ProjectNotFoundError", async () => {
    const { service, projectAccessService } = createTestService();
    projectAccessService.requireProjectRole.mockRejectedValue(
      new ProjectNotFoundError(),
    );

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      ProjectNotFoundError,
    );
  });

  it("does not notify on authorization errors", async () => {
    const { service, projectAccessService, notifyCompileDone } =
      createTestService();
    projectAccessService.requireProjectRole.mockRejectedValue(
      new ProjectRoleRequiredError(["admin", "editor"]),
    );

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      ProjectRoleRequiredError,
    );

    expect(notifyCompileDone).not.toHaveBeenCalled();
  });

  it("notifies with failure on unexpected errors after compile starts", async () => {
    const { service, compileArtifactStore, notifyCompileDone, compileAdapter } =
      createTestService();
    compileAdapter.compile.mockResolvedValue({
      outcome: "completed",
      exitCode: 0,
      logs: "OK",
      pdfContent: Buffer.from("pdf"),
    });
    compileArtifactStore.writePdf.mockRejectedValue(new Error("disk full"));

    await expect(service.compile("project-1", "user-1")).rejects.toThrow(
      "disk full",
    );

    expect(notifyCompileDone).toHaveBeenCalledWith({
      projectId: "project-1",
      status: "failure",
      logs: "An internal error occurred during compilation.",
    });
  });

  it("still returns success when saveLatestBuildPath fails", async () => {
    const {
      service,
      compileAdapter,
      compileArtifactStore,
      compileBuildRepository,
      notifyCompileDone,
    } = createTestService();
    compileAdapter.compile.mockResolvedValue({
      outcome: "completed",
      exitCode: 0,
      logs: "OK",
      pdfContent: Buffer.from("pdf"),
    });
    compileBuildRepository.saveLatestBuildPath.mockRejectedValue(
      new Error("database connection lost"),
    );

    const result = await service.compile("project-1", "user-1");

    expect(result.status).toBe("success");
    expect(compileArtifactStore.writePdf).toHaveBeenCalled();
    expect(notifyCompileDone).toHaveBeenCalledWith({
      projectId: "project-1",
      status: "success",
      logs: expect.any(String),
    });
  });

  it("builds file map from text files only", async () => {
    const { service, compileAdapter, fileAssemblyDeps } = createTestService();

    // Add a binary document to the repository mock
    const binaryDoc = {
      id: "bin-1",
      projectId: "project-1",
      path: "/figures/img.png",
      kind: "binary" as const,
      mime: "image/png",
      contentHash: null,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    };
    fileAssemblyDeps.documentRepository.listForProject.mockResolvedValue([
      createStoredDocument(),
      binaryDoc,
    ]);
    fileAssemblyDeps.snapshotRepository.listForProject.mockResolvedValue([
      {
        id: "snapshot-1",
        projectId: "project-1",
        storagePath: "project-1/existing.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);
    fileAssemblyDeps.snapshotStore.readProjectSnapshot.mockResolvedValue({
      version: 2,
      documents: {
        "bin-1": {
          path: "/figures/img.png",
          kind: "binary",
          mime: "image/png",
          binaryContentBase64: Buffer.from("PNG").toString("base64"),
        },
      },
    });

    await service.compile("project-1", "user-1");

    const compileInput = compileAdapter.compile.mock.calls[0]![0];
    expect(compileInput.files.has("main.tex")).toBe(true);
    expect(compileInput.files.has("figures/img.png")).toBe(false);
  });
});

function createTestService() {
  const projectAccessService: {
    requireProjectRole: ReturnType<
      typeof vi.fn<ProjectAccessService["requireProjectRole"]>
    >;
  } = {
    requireProjectRole: vi.fn().mockResolvedValue({
      project: {
        id: "project-1",
        name: "Test",
        createdAt: new Date(),
        updatedAt: new Date(),
        tombstoneAt: null,
      },
      myRole: "admin" as const,
    }),
  };

  const projectService: {
    getMainDocument: ReturnType<
      typeof vi.fn<ProjectService["getMainDocument"]>
    >;
  } = {
    getMainDocument: vi.fn().mockResolvedValue(createStoredDocument()),
  };

  const compileAdapter: {
    compile: ReturnType<typeof vi.fn<CompileAdapter["compile"]>>;
  } = {
    compile: vi.fn().mockResolvedValue({
      outcome: "completed" as const,
      exitCode: 1,
      logs: "! LaTeX Error",
    }),
  };

  const compileArtifactStore: {
    writePdf: ReturnType<typeof vi.fn<CompileArtifactStore["writePdf"]>>;
    readPdf: ReturnType<typeof vi.fn<CompileArtifactStore["readPdf"]>>;
  } = {
    writePdf: vi.fn().mockResolvedValue(undefined),
    readPdf: vi.fn(),
  };

  const compileBuildRepository: {
    saveLatestBuildPath: ReturnType<
      typeof vi.fn<CompileBuildRepository["saveLatestBuildPath"]>
    >;
  } = {
    saveLatestBuildPath: vi.fn().mockResolvedValue(undefined),
  };

  const notifyCompileDone = vi.fn<(event: CompileDoneEvent) => void>();

  // We need to mock assembleProjectFiles. Since it's a module-level function,
  // we inject the file assembly deps as a mock that the service calls through.
  // The actual assembleProjectFiles is called with these deps.
  const fileAssemblyDeps: FileAssemblyDependencies = {
    documentRepository: {
      listForProject: vi.fn().mockResolvedValue([createStoredDocument()]),
    },
    documentTextStateRepository: {
      findByDocumentIds: vi.fn().mockResolvedValue([
        {
          documentId: "doc-1",
          yjsState: Uint8Array.from([]),
          textContent: "\\documentclass{article}",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    },
    snapshotRepository: {
      listForProject: vi.fn().mockResolvedValue([]),
    },
    snapshotStore: {
      readProjectSnapshot: vi.fn(),
    },
    binaryContentStore: {
      get: vi.fn().mockRejectedValue(new BinaryContentNotFoundError()),
    },
  };

  const service = createCompileDispatchService({
    projectAccessService,
    projectService,
    fileAssemblyDeps,
    compileAdapter,
    compileArtifactStore,
    compileBuildRepository,
    compileTimeoutMs: 60000,
    notifyCompileDone,
  });

  return {
    service,
    projectAccessService,
    projectService,
    compileAdapter,
    compileArtifactStore,
    compileBuildRepository,
    notifyCompileDone,
    fileAssemblyDeps,
  };
}

function createStoredDocument() {
  return {
    id: "doc-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text" as const,
    mime: "text/x-tex",
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
  };
}
