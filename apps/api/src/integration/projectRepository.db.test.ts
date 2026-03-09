import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
} from "../services/project.js";
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

    await repository.softDelete({
      projectId: deletedProject.id,
      actorUserId: owner.id,
      deletedAt: new Date("2026-03-08T12:00:00.000Z"),
    });

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

    const updatedProject = await repository.updateName({
      projectId: project.id,
      actorUserId: owner.id,
      name: `After ${suffix}`,
    });
    await repository.softDelete({
      projectId: project.id,
      actorUserId: owner.id,
      deletedAt: new Date("2026-03-08T13:00:00.000Z"),
    });

    expect(updatedProject).toMatchObject({
      id: project.id,
      name: `After ${suffix}`,
      tombstoneAt: null,
    });
    await expect(
      repository.updateName({
        projectId: project.id,
        actorUserId: owner.id,
        name: `Ignored ${suffix}`,
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      repository.softDelete({
        projectId: project.id,
        actorUserId: owner.id,
        deletedAt: new Date("2026-03-08T14:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("only returns active rows from updateName follow-up reads", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `active-read-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const repository = createProjectRepository(getDb());
    const project = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Project ${suffix}`,
    });

    const updatedProject = await repository.updateName({
      projectId: project.id,
      actorUserId: owner.id,
      name: `Renamed ${suffix}`,
    });

    expect(updatedProject).not.toBeNull();
    expect(updatedProject?.tombstoneAt).toBeNull();
    expect(updatedProject?.name).toBe(`Renamed ${suffix}`);
  });

  it("rejects project writes when the actor is not currently an admin", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `owner-role-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const editor = await getDb().user.create({
      data: {
        email: `editor-role-${suffix}@example.com`,
        name: "Editor",
        passwordHash: "hash",
      },
    });
    const repository = createProjectRepository(getDb());
    const project = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Role Check ${suffix}`,
    });

    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: editor.id,
        role: "editor",
      },
    });

    await expect(
      repository.updateName({
        projectId: project.id,
        actorUserId: editor.id,
        name: `Blocked ${suffix}`,
      }),
    ).rejects.toBeInstanceOf(ProjectAdminRequiredError);
    await expect(
      repository.softDelete({
        projectId: project.id,
        actorUserId: editor.id,
        deletedAt: new Date("2026-03-08T15:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProjectAdminRequiredError);
  });

  it("re-checks actor admin status after waiting on the project lock", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `project-owner-race-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const secondAdmin = await getDb().user.create({
      data: {
        email: `project-admin-race-${suffix}@example.com`,
        name: "Second Admin",
        passwordHash: "hash",
      },
    });
    const repository = createProjectRepository(getDb());
    const writerRepository = createProjectRepository(getDb());
    const lockClient = createTestDatabaseClient();
    const project = await repository.createForOwner({
      ownerUserId: owner.id,
      name: `Project Race ${suffix}`,
    });

    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: secondAdmin.id,
        role: "admin",
      },
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

    const demoteActor = lockClient.$transaction(async (tx) => {
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

      await tx.projectMembership.update({
        where: {
          projectId_userId: {
            projectId: project.id,
            userId: secondAdmin.id,
          },
        },
        data: {
          role: "reader",
        },
      });
    });

    try {
      await lockAcquired;

      const updateProject = writerRepository.updateName({
        projectId: project.id,
        actorUserId: secondAdmin.id,
        name: `Blocked Rename ${suffix}`,
      });

      if (!releaseLock) {
        throw new Error("Expected test lock release handler");
      }

      releaseLock();
      await demoteActor;

      await expect(updateProject).rejects.toBeInstanceOf(
        ProjectAdminRequiredError,
      );
    } finally {
      await lockClient.$disconnect();
    }
  });
});
