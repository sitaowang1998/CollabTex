import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createMembershipRepository } from "../repositories/membershipRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
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
      userId: invited.id,
      role: "reader",
    });
    const listedMembers = await membershipRepository.listMembers(project.id);
    const updatedMembership = await membershipRepository.updateMembershipRole({
      projectId: project.id,
      userId: invited.id,
      role: "editor",
    });
    const adminCountBeforeDelete = await membershipRepository.countAdmins(
      project.id,
    );
    const deleted = await membershipRepository.deleteMembership(
      project.id,
      invited.id,
    );

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
      membershipRepository.findMembership(project.id, invited.id),
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

    await projectRepository.softDelete(
      project.id,
      new Date("2026-03-08T12:00:00.000Z"),
    );

    await expect(membershipRepository.listMembers(project.id)).resolves.toEqual(
      [],
    );
    await expect(
      membershipRepository.createMembership({
        projectId: project.id,
        userId: invited.id,
        role: "reader",
      }),
    ).resolves.toBeNull();
    await expect(
      membershipRepository.updateMembershipRole({
        projectId: project.id,
        userId: owner.id,
        role: "editor",
      }),
    ).resolves.toBeNull();
    await expect(
      membershipRepository.deleteMembership(project.id, owner.id),
    ).resolves.toBe(false);
    await expect(membershipRepository.countAdmins(project.id)).resolves.toBe(0);
  });
});
