import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { ProjectOwnerNotFoundError } from "../services/project.js";
import { createProjectRepository } from "./projectRepository.js";

describe("project repository", () => {
  it("maps owner membership foreign-key errors to ProjectOwnerNotFoundError", async () => {
    const repository = createProjectRepository(
      createDatabaseClientThatRejects(createKnownRequestLikeError("P2003")),
    );

    await expect(
      repository.createForOwner({
        ownerUserId: "missing-user-id",
        name: "Project",
      }),
    ).rejects.toBeInstanceOf(ProjectOwnerNotFoundError);
  });

  it("rethrows non-P2003 create errors", async () => {
    const error = createKnownRequestLikeError("P2002");
    const repository = createProjectRepository(
      createDatabaseClientThatRejects(error),
    );

    await expect(
      repository.createForOwner({
        ownerUserId: "user-1",
        name: "Project",
      }),
    ).rejects.toBe(error);
  });
});

function createKnownRequestLikeError(code: string) {
  return Object.assign(new Error("constraint failed"), {
    code,
  });
}

function createDatabaseClientThatRejects(error: Error): DatabaseClient {
  return {
    $transaction: vi.fn().mockRejectedValue(error),
  } as unknown as DatabaseClient;
}
