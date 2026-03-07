import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient;

function uniqueSuffix() {
  return randomUUID();
}

async function expectKnownRequestError(
  operation: Promise<unknown>,
  expectedCode: string
) {
  try {
    await operation;
    throw new Error(`Expected Prisma error ${expectedCode}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe(
      expectedCode
    );
  }
}

describe("persistence schema integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("connects to the migrated database", async () => {
    const result = await db.$queryRaw<Array<{ one: number }>>`SELECT 1 as one`;

    expect(result).toEqual([{ one: 1 }]);
  });

  it("persists the core Change 2 entities", async () => {
    const suffix = uniqueSuffix();
    const user = await db.user.create({
      data: {
        email: `user-${suffix}@example.com`,
        name: "Test User",
        passwordHash: "hash"
      }
    });
    const project = await db.project.create({
      data: {
        name: `Project ${suffix}`
      }
    });
    const membership = await db.projectMembership.create({
      data: {
        projectId: project.id,
        userId: user.id,
        role: "admin"
      }
    });
    const document = await db.document.create({
      data: {
        projectId: project.id,
        path: "/main.tex",
        kind: "text",
        mime: "text/x-tex",
        contentHash: `hash-${suffix}`
      }
    });
    const snapshot = await db.snapshot.create({
      data: {
        projectId: project.id,
        storagePath: `snapshots/${suffix}.bin`,
        message: "Initial snapshot",
        authorId: user.id
      }
    });

    expect(user.email).toBe(`user-${suffix}@example.com`);
    expect(project.name).toBe(`Project ${suffix}`);
    expect(membership.role).toBe("admin");
    expect(document.path).toBe("/main.tex");
    expect(snapshot.authorId).toBe(user.id);
  });

  it("rejects duplicate document paths within the same project", async () => {
    const suffix = uniqueSuffix();
    const project = await db.project.create({
      data: {
        name: `Project ${suffix}`
      }
    });

    await db.document.create({
      data: {
        projectId: project.id,
        path: "/duplicate.tex",
        kind: "text"
      }
    });

    await expectKnownRequestError(
      db.document.create({
        data: {
          projectId: project.id,
          path: "/duplicate.tex",
          kind: "text"
        }
      }),
      "P2002"
    );
  });

  it("rejects memberships referencing missing parents", async () => {
    await expectKnownRequestError(
      db.projectMembership.create({
        data: {
          projectId: randomUUID(),
          userId: randomUUID(),
          role: "admin"
        }
      }),
      "P2003"
    );
  });

  it("only includes the Change 2 public tables", async () => {
    const rows = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    expect(rows.map(({ tablename }) => tablename)).toEqual([
      "Document",
      "Project",
      "ProjectMembership",
      "Snapshot",
      "User",
      "_prisma_migrations"
    ]);
  });
});
