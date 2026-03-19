import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function uniqueSuffix() {
  return randomUUID();
}

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

async function expectKnownRequestError(
  operation: () => Promise<unknown>,
  expectedCode: string,
) {
  try {
    await operation();
    throw new Error(`Expected Prisma error ${expectedCode}`);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      expect(error.code).toBe(expectedCode);
      return;
    }

    throw error;
  }
}

describe("persistence schema integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("connects to the migrated database", async () => {
    const result = await getDb().$queryRaw<
      Array<{ one: number }>
    >`SELECT 1 as one`;

    expect(result).toEqual([{ one: 1 }]);
  });

  it("persists the core Change 2 entities", async () => {
    const suffix = uniqueSuffix();
    const user = await getDb().user.create({
      data: {
        email: `user-${suffix}@example.com`,
        name: "Test User",
        passwordHash: "hash",
      },
    });
    const project = await getDb().project.create({
      data: {
        name: `Project ${suffix}`,
      },
    });
    const membership = await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: user.id,
        role: "admin",
      },
    });
    const document = await getDb().document.create({
      data: {
        projectId: project.id,
        path: "/main.tex",
        kind: "text",
        mime: "text/x-tex",
        contentHash: `hash-${suffix}`,
      },
    });
    const snapshot = await getDb().snapshot.create({
      data: {
        projectId: project.id,
        storagePath: `snapshots/${suffix}.bin`,
        message: "Initial snapshot",
        authorId: user.id,
      },
    });
    const snapshotRefreshJob = await getDb().snapshotRefreshJob.create({
      data: {
        projectId: project.id,
        requestedByUserId: user.id,
      },
    });

    expect(user.email).toBe(`user-${suffix}@example.com`);
    expect(project.name).toBe(`Project ${suffix}`);
    expect(membership.role).toBe("admin");
    expect(document.path).toBe("/main.tex");
    expect(snapshot.authorId).toBe(user.id);
    expect(snapshotRefreshJob.status).toBe("queued");
  });

  it("rejects duplicate document paths within the same project", async () => {
    const suffix = uniqueSuffix();
    const project = await getDb().project.create({
      data: {
        name: `Project ${suffix}`,
      },
    });

    await getDb().document.create({
      data: {
        projectId: project.id,
        path: "/duplicate.tex",
        kind: "text",
      },
    });

    await expectKnownRequestError(
      () =>
        getDb().document.create({
          data: {
            projectId: project.id,
            path: "/duplicate.tex",
            kind: "text",
          },
        }),
      "P2002",
    );
  });

  it("rejects memberships referencing missing parents", async () => {
    await expectKnownRequestError(
      () =>
        getDb().projectMembership.create({
          data: {
            projectId: randomUUID(),
            userId: randomUUID(),
            role: "admin",
          },
        }),
      "P2003",
    );
  });

  it("includes the current public tables", async () => {
    const rows = await getDb().$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    expect(rows.map(({ tablename }) => tablename)).toEqual([
      "Comment",
      "CommentThread",
      "Document",
      "DocumentTextState",
      "Project",
      "ProjectMembership",
      "Snapshot",
      "SnapshotRefreshJob",
      "User",
      "_prisma_migrations",
    ]);
  });
});
