import { describe, expect, it, vi } from "vitest";
import {
  InvalidSnapshotDataError,
  SnapshotDataNotFoundError,
} from "./snapshot.js";
import {
  createSnapshotRefreshProcessor,
  type SnapshotRefreshJobRepository,
  type SnapshotRefreshProjectLookup,
  type StoredSnapshotRefreshJob,
} from "./snapshotRefresh.js";
import type { DocumentRepository, StoredDocument } from "./document.js";
import type { SnapshotRepository, SnapshotStore } from "./snapshot.js";

describe("snapshot refresh processor", () => {
  it("returns false when no queued job is available", async () => {
    const jobRepository = createJobRepository();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup(),
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
      projectLookup: createProjectLookup(),
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
    snapshotRepository.listForProject.mockResolvedValue([
      {
        id: "snapshot-1",
        projectId: "project-1",
        storagePath: "project-1/old.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);
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
      projectLookup: createProjectLookup(),
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

  it("rebuilds from the newest readable snapshot when the latest blob is missing", async () => {
    const jobRepository = createJobRepository();
    const snapshotRepository = createSnapshotRepository();
    const snapshotStore = createSnapshotStore();
    const documentRepository = createDocumentRepository();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup(),
      snapshotRepository,
      snapshotStore,
      documentRepository,
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    snapshotRepository.listForProject.mockResolvedValue([
      {
        id: "snapshot-2",
        projectId: "project-1",
        storagePath: "project-1/missing.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-02T12:00:00.000Z"),
      },
      {
        id: "snapshot-1",
        projectId: "project-1",
        storagePath: "project-1/older.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);
    snapshotStore.readProjectSnapshot
      .mockRejectedValueOnce(new SnapshotDataNotFoundError())
      .mockResolvedValueOnce({
        version: 1,
        documents: {
          "document-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            content: "\\section{Recovered}",
          },
        },
      });

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(snapshotStore.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.any(String),
      {
        version: 1,
        documents: {
          "document-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            content: "\\section{Recovered}",
          },
        },
      },
    );
    expect(jobRepository.markJobSucceeded).toHaveBeenCalledWith("job-1");
  });

  it("rebuilds from the newest readable snapshot when the latest blob is invalid", async () => {
    const jobRepository = createJobRepository();
    const snapshotRepository = createSnapshotRepository();
    const snapshotStore = createSnapshotStore();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup(),
      snapshotRepository,
      snapshotStore,
      documentRepository: createDocumentRepository(),
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    snapshotRepository.listForProject.mockResolvedValue([
      {
        id: "snapshot-2",
        projectId: "project-1",
        storagePath: "project-1/invalid.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-02T12:00:00.000Z"),
      },
      {
        id: "snapshot-1",
        projectId: "project-1",
        storagePath: "project-1/older.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);
    snapshotStore.readProjectSnapshot
      .mockRejectedValueOnce(
        new InvalidSnapshotDataError("snapshot payload must be valid JSON"),
      )
      .mockResolvedValueOnce({
        version: 1,
        documents: {
          "document-1": {
            path: "/main.tex",
            kind: "text",
            mime: null,
            content: "\\section{Recovered}",
          },
        },
      });

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(snapshotStore.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        documents: {
          "document-1": expect.objectContaining({
            content: "\\section{Recovered}",
          }),
        },
      }),
    );
    expect(jobRepository.markJobSucceeded).toHaveBeenCalledWith("job-1");
  });

  it("rebuilds from an empty state when every previous snapshot blob is unreadable", async () => {
    const jobRepository = createJobRepository();
    const snapshotRepository = createSnapshotRepository();
    const snapshotStore = createSnapshotStore();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup: createProjectLookup(),
      snapshotRepository,
      snapshotStore,
      documentRepository: createDocumentRepository(),
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    snapshotRepository.listForProject.mockResolvedValue([
      {
        id: "snapshot-2",
        projectId: "project-1",
        storagePath: "project-1/missing.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-02T12:00:00.000Z"),
      },
      {
        id: "snapshot-1",
        projectId: "project-1",
        storagePath: "project-1/invalid.json",
        message: null,
        authorId: "user-1",
        createdAt: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);
    snapshotStore.readProjectSnapshot
      .mockRejectedValueOnce(new SnapshotDataNotFoundError())
      .mockRejectedValueOnce(
        new InvalidSnapshotDataError("snapshot payload must be valid JSON"),
      );

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(snapshotStore.writeProjectSnapshot).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        documents: {
          "document-1": expect.objectContaining({
            content: "",
          }),
        },
      }),
    );
  });

  it("marks deleted projects complete without writing a snapshot", async () => {
    const jobRepository = createJobRepository();
    const projectLookup = createProjectLookup();
    const snapshotRepository = createSnapshotRepository();
    const snapshotStore = createSnapshotStore();
    const documentRepository = createDocumentRepository();
    const processor = createSnapshotRefreshProcessor({
      snapshotRefreshJobRepository: jobRepository,
      projectLookup,
      snapshotRepository,
      snapshotStore,
      documentRepository,
    });

    jobRepository.claimNextJob.mockResolvedValue(createJob());
    projectLookup.findActiveById.mockResolvedValue(null);

    await expect(processor.processNextJob()).resolves.toBe(true);
    expect(jobRepository.markJobSucceeded).toHaveBeenCalledWith("job-1");
    expect(documentRepository.listForProject).not.toHaveBeenCalled();
    expect(snapshotStore.writeProjectSnapshot).not.toHaveBeenCalled();
    expect(snapshotRepository.createSnapshot).not.toHaveBeenCalled();
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

function createProjectLookup() {
  return {
    findActiveById: vi
      .fn<SnapshotRefreshProjectLookup["findActiveById"]>()
      .mockResolvedValue({
        id: "project-1",
      }),
  };
}

function createSnapshotRepository() {
  return {
    listForProject: vi
      .fn<SnapshotRepository["listForProject"]>()
      .mockResolvedValue([]),
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
