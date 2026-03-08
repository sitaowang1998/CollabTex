import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("project repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("creates a project and owner membership transactionally", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `owner-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const repository = createProjectRepository(getDb());

    const project = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Project ${suffix}`,
    });

    const membership = await getDb().projectMembership.findUnique({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: owner.id,
        },
      },
    });

    expect(project.name).toBe(`Project ${suffix}`);
    expect(membership).toMatchObject({
      projectId: project.id,
      userId: owner.id,
      role: "admin",
    });
  });

  it("lists and finds only active member projects", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `member-${suffix}@example.com`,
        name: "Member",
        passwordHash: "hash",
      },
    });
    const outsider = await getDb().user.create({
      data: {
        email: `outsider-${suffix}@example.com`,
        name: "Outsider",
        passwordHash: "hash",
      },
    });
    const repository = createProjectRepository(getDb());
    const activeProject = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Active ${suffix}`,
    });
    const deletedProject = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Deleted ${suffix}`,
    });

    await repository.softDelete(
      deletedProject.id,
      new Date("2026-03-08T12:00:00.000Z"),
    );

    await expect(repository.listForUser(owner.id)).resolves.toEqual([
      {
        project: expect.objectContaining({
          id: activeProject.id,
          name: `Active ${suffix}`,
          tombstoneAt: null,
        }),
        myRole: "admin",
      },
    ]);
    await expect(
      repository.findForUser(activeProject.id, owner.id),
    ).resolves.toEqual({
      project: expect.objectContaining({
        id: activeProject.id,
        name: `Active ${suffix}`,
        tombstoneAt: null,
      }),
      myRole: "admin",
    });
    await expect(
      repository.findForUser(activeProject.id, outsider.id),
    ).resolves.toBeNull();
    await expect(
      repository.findForUser(deletedProject.id, owner.id),
    ).resolves.toBeNull();
  });

  it("updates names and soft deletes active projects", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `rename-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const repository = createProjectRepository(getDb());
    const project = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Before ${suffix}`,
    });

    const updatedProject = await repository.updateName(
      project.id,
      `After ${suffix}`,
    );
    const deleted = await repository.softDelete(
      project.id,
      new Date("2026-03-08T13:00:00.000Z"),
    );

    expect(updatedProject).toMatchObject({
      id: project.id,
      name: `After ${suffix}`,
      tombstoneAt: null,
    });
    expect(deleted).toBe(true);
    await expect(
      repository.updateName(project.id, `Ignored ${suffix}`),
    ).resolves.toBeNull();
    await expect(
      repository.softDelete(project.id, new Date("2026-03-08T14:00:00.000Z")),
    ).resolves.toBe(false);
  });
});
