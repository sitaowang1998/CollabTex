import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { DocumentPathConflictError } from "../services/document.js";
import { createDocumentRepository } from "./documentRepository.js";

describe("document repository", () => {
  it("maps unique constraint errors during file creation to DocumentPathConflictError", async () => {
    const repository = createDocumentRepository(
      createDatabaseClientThatRejects(createKnownRequestLikeError("P2002")),
    );

    await expect(
      repository.createDocument({
        projectId: "project-1",
        actorUserId: "user-1",
        path: "main.tex",
        kind: "text",
        mime: null,
      }),
    ).rejects.toBeInstanceOf(DocumentPathConflictError);
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
