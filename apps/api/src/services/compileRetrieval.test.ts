import { describe, expect, it, vi } from "vitest";
import type { CompileArtifactStore } from "./compile.js";
import { CompileArtifactNotFoundError } from "./compile.js";
import type { ProjectAccessService } from "./projectAccess.js";
import { ProjectNotFoundError } from "./projectAccess.js";
import type { CompileBuildRepository } from "../repositories/compileBuildRepository.js";
import {
  createCompileRetrievalService,
  NoBuildExistsError,
} from "./compileRetrieval.js";

describe("compile retrieval service", () => {
  it("returns PDF buffer when build path exists and artifact is readable", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 test");
    const { service } = createTestService({
      latestBuildPath: "project-1/2026-03-21-abc.pdf",
      pdfContent,
    });

    const result = await service.getLatestPdf("project-1", "user-1");

    expect(result).toEqual(pdfContent);
  });

  it("throws NoBuildExistsError when no build path is stored", async () => {
    const { service } = createTestService({ latestBuildPath: null });

    await expect(service.getLatestPdf("project-1", "user-1")).rejects.toThrow(
      NoBuildExistsError,
    );
  });

  it("propagates CompileArtifactNotFoundError when file is missing", async () => {
    const { service, compileArtifactStore } = createTestService({
      latestBuildPath: "project-1/missing.pdf",
    });
    compileArtifactStore.readPdf.mockRejectedValue(
      new CompileArtifactNotFoundError(),
    );

    await expect(service.getLatestPdf("project-1", "user-1")).rejects.toThrow(
      CompileArtifactNotFoundError,
    );
  });

  it("propagates ProjectNotFoundError from access service", async () => {
    const { service, projectAccessService } = createTestService({
      latestBuildPath: "project-1/abc.pdf",
    });
    projectAccessService.requireProjectMember.mockRejectedValue(
      new ProjectNotFoundError(),
    );

    await expect(service.getLatestPdf("project-1", "user-1")).rejects.toThrow(
      ProjectNotFoundError,
    );
  });

  it("calls requireProjectMember not requireProjectRole", async () => {
    const { service, projectAccessService } = createTestService({
      latestBuildPath: "project-1/abc.pdf",
      pdfContent: Buffer.from("pdf"),
    });

    await service.getLatestPdf("project-1", "user-1");

    expect(projectAccessService.requireProjectMember).toHaveBeenCalledWith(
      "project-1",
      "user-1",
    );
  });

  it("reads PDF from the stored path", async () => {
    const storagePath = "project-1/2026-03-21-abc.pdf";
    const { service, compileArtifactStore } = createTestService({
      latestBuildPath: storagePath,
      pdfContent: Buffer.from("pdf"),
    });

    await service.getLatestPdf("project-1", "user-1");

    expect(compileArtifactStore.readPdf).toHaveBeenCalledWith(storagePath);
  });
});

function createTestService({
  latestBuildPath,
  pdfContent,
}: {
  latestBuildPath: string | null;
  pdfContent?: Buffer;
}) {
  const projectAccessService: {
    requireProjectMember: ReturnType<
      typeof vi.fn<ProjectAccessService["requireProjectMember"]>
    >;
  } = {
    requireProjectMember: vi.fn().mockResolvedValue({
      project: {
        id: "project-1",
        name: "Test",
        createdAt: new Date(),
        updatedAt: new Date(),
        tombstoneAt: null,
      },
      myRole: "reader" as const,
    }),
  };

  const compileBuildRepository: {
    getLatestBuildPath: ReturnType<
      typeof vi.fn<CompileBuildRepository["getLatestBuildPath"]>
    >;
  } = {
    getLatestBuildPath: vi.fn().mockResolvedValue(latestBuildPath),
  };

  const compileArtifactStore: {
    readPdf: ReturnType<typeof vi.fn<CompileArtifactStore["readPdf"]>>;
  } = {
    readPdf: vi.fn().mockResolvedValue(pdfContent ?? Buffer.from("")),
  };

  const service = createCompileRetrievalService({
    projectAccessService,
    compileBuildRepository,
    compileArtifactStore,
  });

  return {
    service,
    projectAccessService,
    compileBuildRepository,
    compileArtifactStore,
  };
}
