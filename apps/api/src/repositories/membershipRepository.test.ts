import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  DuplicateProjectMembershipError,
  MembershipUserNotFoundError,
} from "../services/membership.js";
import { createMembershipRepository } from "./membershipRepository.js";

describe("membership repository", () => {
  it("maps duplicate membership errors", async () => {
    const repository = createMembershipRepository(
      createDatabaseClientThatRejects(createKnownRequestLikeError("P2002")),
    );

    await expect(
      repository.createMembership({
        projectId: "project-1",
        userId: "user-1",
        role: "reader",
      }),
    ).rejects.toBeInstanceOf(DuplicateProjectMembershipError);
  });

  it("maps missing user foreign-key errors", async () => {
    const repository = createMembershipRepository(
      createDatabaseClientThatRejects(createKnownRequestLikeError("P2003")),
    );

    await expect(
      repository.createMembership({
        projectId: "project-1",
        userId: "missing-user",
        role: "reader",
      }),
    ).rejects.toBeInstanceOf(MembershipUserNotFoundError);
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
