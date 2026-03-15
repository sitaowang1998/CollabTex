import { describe, expect, it, vi } from "vitest";
import type { DocumentRepository } from "./document.js";
import {
  createSnapshotRefreshProcessor,
  createSnapshotRefreshTrigger,
  type SnapshotRefreshJobRepository,
  type SnapshotRefreshProjectLookup,
} from "./snapshotRefresh.js";
import type { SnapshotService } from "./snapshot.js";

describe("snapshot refresh processor", () => {
  it("captures a new snapshot for a claimed job", async () => {
    const jobRepository = createJobRepository();
    const snapshotService = createSnapshotService();
    const documentRepository = createDocumentRepository();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup(),
      snapshotService,
      documentRepository,
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    documentRepository.listForProject.mockResolvedValue([
      createDocument(),
      createDocument({
        id: "document-2",
        path: "/figure.png",
        kind: "binary",
        mime: "image/png",
      }),
    ]);

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(snapshotService.captureProjectSnapshot).toHaveBeenCalledWith({
      projectId: "project-1",
      authorId: "user-1",
      message: null,
      documents: [
        createDocument(),
        createDocument({
          id: "document-2",
          path: "/figure.png",
          kind: "binary",
          mime: "image/png",
        }),
      ],
    });
    expect(jobRepository.markJobSucceeded).toHaveBeenCalledWith("job-1");
  });

  it("marks jobs failed when snapshot capture throws", async () => {
    const jobRepository = createJobRepository();
    const snapshotService = createSnapshotService();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup(),
      snapshotService,
      documentRepository: createDocumentRepository(),
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    snapshotService.captureProjectSnapshot.mockRejectedValue(
      new Error("snapshot write failed"),
    );

    await expect(processor.processNextJob()).resolves.toBe(false);
    expect(jobRepository.markJobFailed).toHaveBeenCalledWith(
      "job-1",
      "snapshot refresh failed; see logs for details",
    );
  });

  it("completes deleted-project jobs without writing a snapshot", async () => {
    const jobRepository = createJobRepository();
    const snapshotService = createSnapshotService();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup({
        findActiveById: vi.fn().mockResolvedValue(null),
      }),
      snapshotService,
      documentRepository: createDocumentRepository(),
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(snapshotService.captureProjectSnapshot).not.toHaveBeenCalled();
    expect(jobRepository.markJobSucceeded).toHaveBeenCalledWith("job-1");
  });
});

describe("snapshot refresh trigger", () => {
  it("drains queued work when kicked", async () => {
    const processor = {
      processNextJob: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const trigger = createSnapshotRefreshTrigger({
      snapshotRefreshProcessor: processor,
      pollIntervalMs: 60_000,
    });

    try {
      trigger.kick();
      await vi.waitFor(() => {
        expect(processor.processNextJob).toHaveBeenCalledTimes(3);
      });
    } finally {
      trigger.stop();
    }
  });
});

function createJobRepository(
  overrides: Partial<SnapshotRefreshJobRepository> = {},
) {
  return {
    claimNextJob: vi.fn<SnapshotRefreshJobRepository["claimNextJob"]>(),
    recoverInterruptedJobs:
      vi.fn<SnapshotRefreshJobRepository["recoverInterruptedJobs"]>(),
    markJobSucceeded: vi.fn<SnapshotRefreshJobRepository["markJobSucceeded"]>(),
    markJobFailed: vi.fn<SnapshotRefreshJobRepository["markJobFailed"]>(),
    ...overrides,
  };
}

function createProjectLookup(
  overrides: Partial<SnapshotRefreshProjectLookup> = {},
) {
  return {
    findActiveById: vi
      .fn<SnapshotRefreshProjectLookup["findActiveById"]>()
      .mockResolvedValue({
        id: "project-1",
      }),
    ...overrides,
  };
}

function createSnapshotService(
  overrides: Partial<Pick<SnapshotService, "captureProjectSnapshot">> = {},
) {
  return {
    captureProjectSnapshot: vi
      .fn<SnapshotService["captureProjectSnapshot"]>()
      .mockResolvedValue(createSnapshot()),
    ...overrides,
  };
}

function createDocumentRepository(
  overrides: Partial<Pick<DocumentRepository, "listForProject">> = {},
) {
  return {
    listForProject: vi
      .fn<DocumentRepository["listForProject"]>()
      .mockResolvedValue([]),
    ...overrides,
  };
}

function createJob() {
  return {
    id: "job-1",
    projectId: "project-1",
    requestedByUserId: "user-1",
    status: "queued" as const,
    attemptCount: 0,
    lastError: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
  };
}

function createSnapshot() {
  return {
    id: "snapshot-1",
    projectId: "project-1",
    storagePath: "project-1/snapshot.json",
    message: null,
    authorId: "user-1",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
  };
}

function createDocument(
  overrides: Partial<
    Awaited<ReturnType<DocumentRepository["listForProject"]>>[number]
  > = {},
) {
  return {
    id: "document-1",
    projectId: "project-1",
    path: "/main.tex",
    kind: "text" as const,
    mime: null,
    contentHash: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}
