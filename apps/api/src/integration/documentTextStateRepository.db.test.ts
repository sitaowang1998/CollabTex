import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createCollaborationService } from "../services/collaboration.js";
import {
  DocumentTextStateDocumentNotFoundError,
  UnsupportedCurrentTextStateDocumentError,
  type StoredDocumentTextState,
} from "../services/currentTextState.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("document text state repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("creates and reads current text state for text documents", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-state-${suffix}@example.com`);
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const repository = createDocumentTextStateRepository(getDb());
    const document = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const initialState = createStoredTextState("\\section{Draft}");

    const created = await repository.create({
      documentId: document.id,
      yjsState: initialState.yjsState,
      textContent: initialState.textContent,
    });

    await expect(repository.findByDocumentId(document.id)).resolves.toEqual(
      created,
    );
    expect(created).toMatchObject({
      documentId: document.id,
      textContent: "\\section{Draft}",
      version: 1,
    });
  });

  it("reads multiple current text states in one batch", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-state-batch-${suffix}@example.com`);
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const repository = createDocumentTextStateRepository(getDb());
    const mainDocument = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const appendixDocument = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/appendix.tex",
      kind: "text",
      mime: "text/x-tex",
    });

    await repository.create({
      documentId: mainDocument.id,
      ...createStoredTextState("\\section{Main}"),
    });
    await repository.create({
      documentId: appendixDocument.id,
      ...createStoredTextState("\\section{Appendix}"),
    });

    await expect(
      repository.findByDocumentIds([
        mainDocument.id,
        appendixDocument.id,
        "00000000-0000-0000-0000-000000000000",
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: mainDocument.id,
          textContent: "\\section{Main}",
        }),
        expect.objectContaining({
          documentId: appendixDocument.id,
          textContent: "\\section{Appendix}",
        }),
      ]),
    );
  });

  it("updates current text state with optimistic versioning", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-state-update-${suffix}@example.com`);
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });
    const repository = createDocumentTextStateRepository(getDb());

    await repository.create({
      documentId: document.id,
      ...createStoredTextState("Draft"),
    });

    await expect(
      repository.update({
        documentId: document.id,
        ...createStoredTextState("Draft v2"),
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      documentId: document.id,
      textContent: "Draft v2",
      version: 2,
    });
    await expect(
      repository.update({
        documentId: document.id,
        ...createStoredTextState("Draft v3"),
        expectedVersion: 1,
      }),
    ).resolves.toBeNull();
  });

  it("treats updates without an existing text-state row as not found", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `doc-state-missing-row-${suffix}@example.com`,
    );
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });
    const repository = createDocumentTextStateRepository(getDb());

    await expect(
      repository.update({
        documentId: document.id,
        ...createStoredTextState("Draft v2"),
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(DocumentTextStateDocumentNotFoundError);
  });

  it("rejects missing and binary documents", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-state-invalid-${suffix}@example.com`);
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const binaryDocument = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/figure.png",
      kind: "binary",
      mime: "image/png",
    });
    const repository = createDocumentTextStateRepository(getDb());
    const state = createStoredTextState("ignored");

    await expect(
      repository.create({
        documentId: "00000000-0000-0000-0000-000000000000",
        yjsState: state.yjsState,
        textContent: state.textContent,
      }),
    ).rejects.toBeInstanceOf(DocumentTextStateDocumentNotFoundError);
    await expect(
      repository.create({
        documentId: binaryDocument.id,
        yjsState: state.yjsState,
        textContent: state.textContent,
      }),
    ).rejects.toBeInstanceOf(UnsupportedCurrentTextStateDocumentError);
  });

  it("cascades text state deletion with its document", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-state-delete-${suffix}@example.com`);
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const document = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });
    const repository = createDocumentTextStateRepository(getDb());

    await repository.create({
      documentId: document.id,
      ...createStoredTextState("Draft"),
    });
    await documentRepository.deleteNode({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
    });

    await expect(repository.findByDocumentId(document.id)).resolves.toBeNull();
  });

  it("hides current text state for tombstoned projects", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-state-tombstone-${suffix}@example.com`);
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });
    const repository = createDocumentTextStateRepository(getDb());

    await repository.create({
      documentId: document.id,
      ...createStoredTextState("Draft"),
    });
    await getDb().project.update({
      where: {
        id: project.id,
      },
      data: {
        tombstoneAt: new Date("2026-03-14T12:00:00.000Z"),
      },
    });

    await expect(repository.findByDocumentId(document.id)).resolves.toBeNull();
  });

  it("treats tombstoned projects as missing for writes", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `doc-state-tombstone-write-${suffix}@example.com`,
    );
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });
    const repository = createDocumentTextStateRepository(getDb());
    const draftState = createStoredTextState("Draft");

    await getDb().project.update({
      where: {
        id: project.id,
      },
      data: {
        tombstoneAt: new Date("2026-03-14T12:00:00.000Z"),
      },
    });

    await expect(
      repository.create({
        documentId: document.id,
        yjsState: draftState.yjsState,
        textContent: draftState.textContent,
      }),
    ).rejects.toBeInstanceOf(DocumentTextStateDocumentNotFoundError);

    await getDb().project.update({
      where: {
        id: project.id,
      },
      data: {
        tombstoneAt: null,
      },
    });
    await repository.create({
      documentId: document.id,
      yjsState: draftState.yjsState,
      textContent: draftState.textContent,
    });
    await getDb().project.update({
      where: {
        id: project.id,
      },
      data: {
        tombstoneAt: new Date("2026-03-14T12:05:00.000Z"),
      },
    });

    await expect(
      repository.update({
        documentId: document.id,
        ...createStoredTextState("Draft v2"),
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(DocumentTextStateDocumentNotFoundError);
  });

  it("treats a document deleted while the write waits on the project lock as missing", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `doc-state-race-delete-${suffix}@example.com`,
    );
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const documentRepository = createDocumentRepository(getDb());
    const repository = createDocumentTextStateRepository(getDb());
    const lockClient = createTestDatabaseClient();
    const document = await documentRepository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });

    await repository.create({
      documentId: document.id,
      ...createStoredTextState("Draft"),
    });
    await lockClient.$connect();

    let markLockAcquired: (() => void) | undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const deleteDocument = lockClient.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM "Project"
        WHERE id = CAST(${project.id} AS uuid)
        FOR UPDATE
      `);

      if (!markLockAcquired) {
        throw new Error("Expected test lock acquired handler");
      }

      markLockAcquired();
      await lockReleased;

      await tx.document.delete({
        where: {
          id: document.id,
        },
      });
    });

    try {
      await lockAcquired;

      const pendingUpdate = repository.update({
        documentId: document.id,
        ...createStoredTextState("Draft v2"),
        expectedVersion: 1,
      });

      if (!releaseLock) {
        throw new Error("Expected test lock release handler");
      }

      releaseLock();
      await deleteDocument;

      await expect(pendingUpdate).rejects.toBeInstanceOf(
        DocumentTextStateDocumentNotFoundError,
      );
    } finally {
      await lockClient.$disconnect();
    }
  });

  it("treats a project tombstoned while create waits on the project lock as missing", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `doc-state-race-tombstone-${suffix}@example.com`,
    );
    const project = await createProject(owner.id, `Document State ${suffix}`);
    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: null,
    });
    const repository = createDocumentTextStateRepository(getDb());
    const lockClient = createTestDatabaseClient();

    await lockClient.$connect();

    let markLockAcquired: (() => void) | undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const tombstoneProject = lockClient.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM "Project"
        WHERE id = CAST(${project.id} AS uuid)
        FOR UPDATE
      `);

      if (!markLockAcquired) {
        throw new Error("Expected test lock acquired handler");
      }

      markLockAcquired();
      await lockReleased;

      await tx.project.update({
        where: {
          id: project.id,
        },
        data: {
          tombstoneAt: new Date("2026-03-14T13:00:00.000Z"),
        },
      });
    });

    try {
      await lockAcquired;

      const pendingCreate = repository.create({
        documentId: document.id,
        ...createStoredTextState("Draft"),
      });

      if (!releaseLock) {
        throw new Error("Expected test lock release handler");
      }

      releaseLock();
      await tombstoneProject;

      await expect(pendingCreate).rejects.toBeInstanceOf(
        DocumentTextStateDocumentNotFoundError,
      );
    } finally {
      await lockClient.$disconnect();
    }
  });
});

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "User",
      passwordHash: "hash",
    },
  });
}

async function createProject(ownerUserId: string, name: string) {
  return createProjectRepository(getDb()).createForOwner({
    ownerUserId,
    name,
  });
}

function createStoredTextState(
  textContent: string,
): Pick<StoredDocumentTextState, "textContent" | "yjsState"> {
  const collaborationDocument =
    createCollaborationService().createDocumentFromText(textContent);

  try {
    return {
      yjsState: collaborationDocument.exportUpdate(),
      textContent: collaborationDocument.getText(),
    };
  } finally {
    collaborationDocument.destroy();
  }
}
