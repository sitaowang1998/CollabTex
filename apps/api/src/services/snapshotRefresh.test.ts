import { describe, expect, it, vi } from "vitest";
import {
  createSnapshotRefreshProcessor,
  type SnapshotRefreshJobRepository,
  type StoredSnapshotRefreshJob,
} from "./snapshotRefresh.js";
import type { DocumentRepository, StoredDocument } from "./document.js";
import type { SnapshotRepository, SnapshotStore } from "./snapshot.js";

describe("snapshot refresh processor", () => {
  it("returns false when no queued job is available", async () => {
    const jobRepository = createJobRepository();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      snapshotRepository: createSnapshotRepository(),
      snapshotStore: createSnapshotStore(),
      documentRepository: createDocumentRepository(),
    });

    jobRepository.claimNextJob.mockResolvedValue(null);

    await expect(processor.processNextJob()).resolves.toBe(false);
  });

  it("builds and persists a snapshot for a claimed job", async () => {
    const jobRepository = createJobRepository();
    const snapshotRepository = createSnapshotRepository();
    const snapshotStore = createSnapshotStore();
    const documentRepository = createDocumentRepository();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      snapshotRepository,
      snapshotStore,
      documentRepository,
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    documentRepository.listForProject.mockResolvedValue([
      createDocument({
        id: "document-1",
        path: "/renamed.tex",
      }),
    ]);
    snapshotRepository.findLatestForProject.mockResolvedValue({
      id: "snapshot-1",
      projectId: "project-1",
      storagePath: "project-1/old.json",
      message: null,
      authorId: "user-1",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    });
    snapshotStore.readProjectSnapshot.mockResolvedValue({
      version: 1,
      documents: {
        "document-1": {
          path: "/main.tex",
          kind: "text",
          mime: null,
          content: "\\section{Carried}",
        },
      },
    });

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(snapshotStore.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/.+\.json$/),
      {
        version: 1,
        documents: {
          "document-1": {
            path: "/renamed.tex",
            kind: "text",
            mime: null,
            content: "\\section{Carried}",
          },
        },
      },
    );
    expect(jobRepository.markJobSucceeded).toHaveBeenCalledWith("job-1");
  });

  it("marks the job failed when snapshot persistence throws", async () => {
    const jobRepository = createJobRepository();
    const snapshotStore = createSnapshotStore();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      snapshotRepository: createSnapshotRepository(),
      snapshotStore,
      documentRepository: createDocumentRepository(),
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    snapshotStore.writeProjectSnapshot.mockRejectedValue(
      new Error("disk full at /tmp/private"),
    );

    await expect(processor.processNextJob()).resolves.toBe(false);
    expect(jobRepository.markJobFailed).toHaveBeenCalledWith(
      "job-1",
      "disk full at /tmp/private",
    );
  });
});

function createJobRepository() {
  return {
    claimNextJob: vi.fn<SnapshotRefreshJobRepository["claimNextJob"]>(),
    recoverInterruptedJobs:
      vi.fn<SnapshotRefreshJobRepository["recoverInterruptedJobs"]>(),
    markJobSucceeded: vi.fn<SnapshotRefreshJobRepository["markJobSucceeded"]>(),
    markJobFailed: vi.fn<SnapshotRefreshJobRepository["markJobFailed"]>(),
  };
}

function createSnapshotRepository() {
  return {
    findLatestForProject: vi
      .fn<SnapshotRepository["findLatestForProject"]>()
      .mockResolvedValue(null),
    createSnapshot: vi
      .fn<SnapshotRepository["createSnapshot"]>()
      .mockResolvedValue({
        id: "snapshot-2",
        projectId: "project-1",
        storagePath: "project-1/new.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
      }),
  };
}

function createSnapshotStore() {
  return {
    readProjectSnapshot: vi
      .fn<SnapshotStore["readProjectSnapshot"]>()
      .mockResolvedValue({
        version: 1,
        documents: {},
      }),
    writeProjectSnapshot: vi
      .fn<SnapshotStore["writeProjectSnapshot"]>()
      .mockResolvedValue(undefined),
  };
}

function createDocumentRepository() {
  return {
    listForProject: vi
      .fn<DocumentRepository["listForProject"]>()
      .mockResolvedValue([createDocument()]),
  };
}

function createDocument(
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

function createJob(
  overrides: Partial<StoredSnapshotRefreshJob> = {},
): StoredSnapshotRefreshJob {
  return {
    id: "job-1",
    projectId: "project-1",
    requestedByUserId: "user-1",
    status: "queued",
    attemptCount: 0,
    lastError: null,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}
