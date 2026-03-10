import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import {
  DocumentPathConflictError,
  InvalidDocumentPathError,
  type StoredDocument,
} from "../services/document.js";
import { ProjectRoleRequiredError } from "../services/project.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("document repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("creates and finds project documents for active projects", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-owner-${suffix}@example.com`);
    const project = await createProject(owner.id, `Documents ${suffix}`);
    const repository = createDocumentRepository(getDb());

    const createdDocument = await repository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/src/main.tex",
      kind: "text",
      mime: "text/plain",
    });
    const projectDocuments = await repository.listForProject(project.id);

    await expect(
      repository.findByPath(project.id, "/src/main.tex"),
    ).resolves.toMatchObject({
      id: createdDocument.id,
      path: "/src/main.tex",
      kind: "text",
      mime: "text/plain",
    });
    expect(projectDocuments).toEqual([
      expect.objectContaining({
        id: createdDocument.id,
        path: "/src/main.tex",
        kind: "text",
        mime: "text/plain",
      }),
    ]);
  });

  it("rejects file and folder collisions caused by path prefixes", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-collision-${suffix}@example.com`);
    const project = await createProject(owner.id, `Collision ${suffix}`);
    const repository = createDocumentRepository(getDb());

    await repository.createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/docs/main.tex",
      kind: "text",
      mime: null,
    });

    await expect(
      repository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/docs/main.tex",
        kind: "text",
        mime: null,
      }),
    ).rejects.toBeInstanceOf(DocumentPathConflictError);
    await expect(
      repository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/docs",
        kind: "binary",
        mime: "application/octet-stream",
      }),
    ).rejects.toBeInstanceOf(DocumentPathConflictError);
    await expect(
      repository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/docs/main.tex/notes.txt",
        kind: "text",
        mime: null,
      }),
    ).rejects.toBeInstanceOf(DocumentPathConflictError);
  });

  it("moves folders by rewriting descendant paths and blocks descendant moves", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-move-${suffix}@example.com`);
    const project = await createProject(owner.id, `Move ${suffix}`);
    const repository = createDocumentRepository(getDb());

    await createDocuments(repository, project.id, owner.id, [
      { path: "/chapters/one.tex", kind: "text", mime: null },
      {
        path: "/chapters/images/figure.png",
        kind: "binary",
        mime: "image/png",
      },
    ]);

    await expect(
      repository.moveNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/chapters",
        nextPath: "/archive/chapters",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.moveNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/archive/chapters",
        nextPath: "/archive/chapters/images/archive",
      }),
    ).rejects.toBeInstanceOf(DocumentPathConflictError);
    await expect(repository.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        path: "/archive/chapters/images/figure.png",
      }),
      expect.objectContaining({
        path: "/archive/chapters/one.tex",
      }),
    ]);
  });

  it("stages overlapping descendant rewrites without transient unique collisions", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-overlap-${suffix}@example.com`);
    const project = await createProject(owner.id, `Overlap ${suffix}`);
    const repository = createDocumentRepository(getDb());

    await createDocuments(repository, project.id, owner.id, [
      { path: "/a/a/a/b", kind: "text", mime: null },
      { path: "/a/a/a/a/b", kind: "text", mime: null },
    ]);

    await expect(
      repository.moveNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/a/a",
        nextPath: "/a",
      }),
    ).resolves.toBe(true);

    const documents = await repository.listForProject(project.id);

    expect(documents.map((document) => document.path)).toEqual([
      "/a/a/a/b",
      "/a/a/b",
    ]);
    expect(documents.every((document) => document.path.startsWith("/"))).toBe(
      true,
    );
  });

  it("treats same-path folder moves as no-ops", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-noop-${suffix}@example.com`);
    const project = await createProject(owner.id, `Noop ${suffix}`);
    const repository = createDocumentRepository(getDb());

    await createDocuments(repository, project.id, owner.id, [
      { path: "/docs/main.tex", kind: "text", mime: null },
      { path: "/docs/figures/plot.png", kind: "binary", mime: "image/png" },
    ]);

    await expect(
      repository.moveNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/docs",
        nextPath: "/docs",
      }),
    ).resolves.toBe(true);

    await expect(repository.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        path: "/docs/figures/plot.png",
      }),
      expect.objectContaining({
        path: "/docs/main.tex",
      }),
    ]);
  });

  it("rejects folder moves whose rewritten descendants exceed the path limit", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-too-long-${suffix}@example.com`);
    const project = await createProject(owner.id, `Too Long ${suffix}`);
    const repository = createDocumentRepository(getDb());
    const destinationPath = `/${"b".repeat(1023)}`;

    await createDocuments(repository, project.id, owner.id, [
      { path: "/a/child.tex", kind: "text", mime: null },
      { path: "/a/nested/figure.png", kind: "binary", mime: "image/png" },
    ]);

    await expect(
      repository.moveNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/a",
        nextPath: destinationPath,
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentPathError);

    await expect(repository.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        path: "/a/child.tex",
      }),
      expect.objectContaining({
        path: "/a/nested/figure.png",
      }),
    ]);
  });

  it("deletes folder descendants and restricts writers to admins and editors", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`doc-delete-owner-${suffix}@example.com`);
    const commenter = await createUser(
      `doc-delete-commenter-${suffix}@example.com`,
    );
    const project = await createProject(owner.id, `Delete ${suffix}`);
    const repository = createDocumentRepository(getDb());

    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: commenter.id,
        role: "commenter",
      },
    });
    await createDocuments(repository, project.id, owner.id, [
      { path: "/drafts/intro.tex", kind: "text", mime: null },
      { path: "/drafts/figures/plot.png", kind: "binary", mime: "image/png" },
      { path: "/drafts-2/keep.tex", kind: "text", mime: null },
    ]);

    await expect(
      repository.createDocument({
        projectId: project.id,
        actorUserId: commenter.id,
        path: "/drafts/notes.tex",
        kind: "text",
        mime: null,
      }),
    ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
    await expect(
      repository.deleteNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/drafts",
      }),
    ).resolves.toBe(true);
    await expect(repository.listForProject(project.id)).resolves.toEqual([
      expect.objectContaining({
        path: "/drafts-2/keep.tex",
      }),
    ]);
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

async function createDocuments(
  repository: ReturnType<typeof createDocumentRepository>,
  projectId: string,
  actorUserId: string,
  documents: Array<Pick<StoredDocument, "path" | "kind" | "mime">>,
) {
  for (const document of documents) {
    await repository.createDocument({
      projectId,
      actorUserId,
      path: document.path,
      kind: document.kind,
      mime: document.mime,
    });
  }
}
