import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createMembershipRepository } from "../repositories/membershipRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { LastProjectAdminRemovalError } from "../services/membership.js";
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

describe("membership repository integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("lists, creates, updates, and deletes memberships for active projects", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `owner-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const invited = await getDb().user.create({
      data: {
        email: `invited-${suffix}@example.com`,
        name: "Invited",
        passwordHash: "hash",
      },
    });
    const projectRepository = createProjectRepository(getDb());
    const membershipRepository = createMembershipRepository(getDb());
    const project = await projectRepository.createForOwner({
      ownerUserId: owner.id,
      name: `Project ${suffix}`,
    });

    const createdMembership = await membershipRepository.createMembership({
      projectId: project.id,
      actorUserId: owner.id,
      userId: invited.id,
      role: "reader",
    });
    const listedMembers = await membershipRepository.listMembersForUser(
      project.id,
      owner.id,
    );
    const updatedMembership = await membershipRepository.updateMembershipRole({
      projectId: project.id,
      actorUserId: owner.id,
      userId: invited.id,
      role: "editor",
    });
    const adminCountBeforeDelete = await getDb().projectMembership.count({
      where: {
        projectId: project.id,
        role: "admin",
      },
    });
    const deleted = await membershipRepository.deleteMembership({
      projectId: project.id,
      actorUserId: owner.id,
      userId: invited.id,
    });

    expect(createdMembership).toEqual({
      userId: invited.id,
      email: `invited-${suffix}@example.com`,
      name: "Invited",
      role: "reader",
    });
    expect(listedMembers).toEqual([
      {
        userId: owner.id,
        email: `owner-${suffix}@example.com`,
        name: "Owner",
        role: "admin",
      },
      {
        userId: invited.id,
        email: `invited-${suffix}@example.com`,
        name: "Invited",
        role: "reader",
      },
    ]);
    expect(updatedMembership).toEqual({
      userId: invited.id,
      email: `invited-${suffix}@example.com`,
      name: "Invited",
      role: "editor",
    });
    expect(adminCountBeforeDelete).toBe(1);
    expect(deleted).toBe(true);
    await expect(
      getDb().projectMembership.findUnique({
        where: {
          projectId_userId: {
            projectId: project.id,
            userId: invited.id,
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it("scopes membership reads and writes to active projects", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `deleted-owner-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const invited = await getDb().user.create({
      data: {
        email: `deleted-invited-${suffix}@example.com`,
        name: "Invited",
        passwordHash: "hash",
      },
    });
    const projectRepository = createProjectRepository(getDb());
    const membershipRepository = createMembershipRepository(getDb());
    const project = await projectRepository.createForOwner({
      ownerUserId: owner.id,
      name: `Deleted ${suffix}`,
    });

    await projectRepository.softDelete({
      projectId: project.id,
      actorUserId: owner.id,
      deletedAt: new Date("2026-03-08T12:00:00.000Z"),
    });

    await expect(
      membershipRepository.listMembersForUser(project.id, owner.id),
    ).resolves.toBeNull();
    await expect(
      membershipRepository.createMembership({
        projectId: project.id,
        actorUserId: owner.id,
        userId: invited.id,
        role: "reader",
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      membershipRepository.updateMembershipRole({
        projectId: project.id,
        actorUserId: owner.id,
        userId: owner.id,
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      membershipRepository.deleteMembership({
        projectId: project.id,
        actorUserId: owner.id,
        userId: owner.id,
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      getDb().projectMembership.count({
        where: {
          projectId: project.id,
          role: "admin",
          project: {
            tombstoneAt: null,
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it("serializes concurrent admin removals so one admin always remains", async () => {
    const suffix = randomUUID();
    const firstAdmin = await getDb().user.create({
      data: {
        email: `first-admin-${suffix}@example.com`,
        name: "First Admin",
        passwordHash: "hash",
      },
    });
    const secondAdmin = await getDb().user.create({
      data: {
        email: `second-admin-${suffix}@example.com`,
        name: "Second Admin",
        passwordHash: "hash",
      },
    });
    const projectRepository = createProjectRepository(getDb());
    const repositoryOne = createMembershipRepository(getDb());
    const repositoryTwo = createMembershipRepository(getDb());
    const project = await projectRepository.createForOwner({
      ownerUserId: firstAdmin.id,
      name: `Concurrent ${suffix}`,
    });

    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: secondAdmin.id,
        role: "admin",
      },
    });

    const results = await Promise.allSettled([
      repositoryOne.deleteMembership({
        projectId: project.id,
        actorUserId: firstAdmin.id,
        userId: firstAdmin.id,
      }),
      repositoryTwo.deleteMembership({
        projectId: project.id,
        actorUserId: secondAdmin.id,
        userId: secondAdmin.id,
      }),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<boolean> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value).toBe(true);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(LastProjectAdminRemovalError);
    await expect(
      getDb().projectMembership.count({
        where: {
          projectId: project.id,
          role: "admin",
        },
      }),
    ).resolves.toBe(1);
  });

  it("re-checks actor admin status after waiting on the project lock", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `owner-race-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const secondAdmin = await getDb().user.create({
      data: {
        email: `second-admin-race-${suffix}@example.com`,
        name: "Second Admin",
        passwordHash: "hash",
      },
    });
    const target = await getDb().user.create({
      data: {
        email: `target-race-${suffix}@example.com`,
        name: "Target",
        passwordHash: "hash",
      },
    });
    const projectRepository = createProjectRepository(getDb());
    const writerRepository = createMembershipRepository(getDb());
    const lockClient = createTestDatabaseClient();
    const project = await projectRepository.createForOwner({
      ownerUserId: owner.id,
      name: `Actor Race ${suffix}`,
    });

    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: secondAdmin.id,
        role: "admin",
      },
    });
    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: target.id,
        role: "reader",
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

      const actorWrite = writerRepository.updateMembershipRole({
        projectId: project.id,
        actorUserId: secondAdmin.id,
        userId: target.id,
        role: "editor",
      });
      // Prevent Node unhandled-rejection if this rejects before we await it below
      actorWrite.catch(() => {});

      if (!releaseLock) {
        throw new Error("Expected test lock release handler");
      }

      releaseLock();
      await demoteActor;

      await expect(actorWrite).rejects.toBeInstanceOf(
        ProjectAdminRequiredError,
      );
    } finally {
      await lockClient.$disconnect();
    }
  });

  it("blocks membership creation once a waiting write resumes after project deletion", async () => {
    const suffix = randomUUID();
    const owner = await getDb().user.create({
      data: {
        email: `create-owner-${suffix}@example.com`,
        name: "Owner",
        passwordHash: "hash",
      },
    });
    const invited = await getDb().user.create({
      data: {
        email: `create-invited-${suffix}@example.com`,
        name: "Invited",
        passwordHash: "hash",
      },
    });
    const projectRepository = createProjectRepository(getDb());
    const membershipRepository = createMembershipRepository(getDb());
    const lockClient = createTestDatabaseClient();
    const project = await projectRepository.createForOwner({
      ownerUserId: owner.id,
      name: `Create Race ${suffix}`,
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

    const deleteProject = lockClient.$transaction(async (tx) => {
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
          tombstoneAt: new Date("2026-03-08T20:00:00.000Z"),
        },
      });
    });

    try {
      await lockAcquired;

      const createMembership = membershipRepository.createMembership({
        projectId: project.id,
        actorUserId: owner.id,
        userId: invited.id,
        role: "reader",
      });
      // Prevent Node unhandled-rejection if this rejects before we await it below
      createMembership.catch(() => {});

      if (!releaseLock) {
        throw new Error("Expected test lock release handler");
      }

      releaseLock();
      await deleteProject;

      await expect(createMembership).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    } finally {
      await lockClient.$disconnect();
    }
  });
});
