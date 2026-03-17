import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createActiveDocumentRegistry } from "../services/activeDocumentRegistry.js";
import { createActiveDocumentStateLoader } from "../services/activeDocumentStateLoader.js";
import { createCollaborationService } from "../services/collaboration.js";
import { createCurrentTextStateService } from "../services/currentTextState.js";
import { createProjectAccessService } from "../services/projectAccess.js";
import { createRealtimeDocumentService } from "../services/realtimeDocument.js";
import { createSnapshotService } from "../services/snapshot.js";
import { createWorkspaceService } from "../services/workspace.js";
import { createSnapshotRepository } from "../repositories/snapshotRepository.js";
import { createProjectStateRepository } from "../repositories/projectStateRepository.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }

  return db;
}

describe("realtime document integration", () => {
  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
  });

  it("persists an accepted write so restart does not wait for idle close", async () => {
    const suffix = randomUUID();
    const owner = await createUser(`realtime-restart-${suffix}@example.com`);
    const project = await createProject(owner.id, `Realtime Restart ${suffix}`);
    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    const firstRuntime = createRuntime();
    const opened = await firstRuntime.workspaceService.openDocument({
      projectId: project.id,
      documentId: document.id,
      userId: owner.id,
    });
    const sessionHandle = await firstRuntime.activeDocumentRegistry.join({
      projectId: project.id,
      documentId: document.id,
    });

    await firstRuntime.realtimeDocumentService.applyUpdate({
      projectId: project.id,
      documentId: document.id,
      userId: owner.id,
      sessionHandle,
      update: createIncrementalUpdate(opened.initialSync!.yjsState, (yDoc) => {
        yDoc.getText("content").insert(0, "\\section{Rebuilt}\n");
      }),
      isCurrentSession: () => true,
    });

    const secondRuntime = createRuntime();
    const reopened = await secondRuntime.workspaceService.openDocument({
      projectId: project.id,
      documentId: document.id,
      userId: owner.id,
    });

    expect(reopened.initialSync).toMatchObject({
      documentId: document.id,
      serverVersion: 2,
    });
    expect(decodeState(reopened.initialSync!.yjsState)).toBe(
      "\\section{Rebuilt}\n",
    );

    await sessionHandle.leave();
  });

  it("serializes concurrent accepted updates without overwriting earlier writes", async () => {
    const suffix = randomUUID();
    const owner = await createUser(
      `realtime-concurrency-${suffix}@example.com`,
    );
    const editor = await createUser(`realtime-editor-${suffix}@example.com`);
    const project = await createProject(
      owner.id,
      `Realtime Concurrency ${suffix}`,
    );

    await getDb().projectMembership.create({
      data: {
        projectId: project.id,
        userId: editor.id,
        role: "editor",
      },
    });

    const document = await createDocumentRepository(getDb()).createDocument({
      projectId: project.id,
      actorUserId: owner.id,
      path: "/main.tex",
      kind: "text",
      mime: "text/x-tex",
    });
    await seedTextState(document.id, "Base");
    const runtime = createRuntime();
    const opened = await runtime.workspaceService.openDocument({
      projectId: project.id,
      documentId: document.id,
      userId: owner.id,
    });
    const firstHandle = await runtime.activeDocumentRegistry.join({
      projectId: project.id,
      documentId: document.id,
    });
    const secondHandle = await runtime.activeDocumentRegistry.join({
      projectId: project.id,
      documentId: document.id,
    });

    const baseState = opened.initialSync!.yjsState;
    await Promise.all([
      runtime.realtimeDocumentService.applyUpdate({
        projectId: project.id,
        documentId: document.id,
        userId: owner.id,
        sessionHandle: firstHandle,
        update: createIncrementalUpdate(baseState, (yDoc) => {
          yDoc.getText("content").insert(0, "Brave ");
        }),
        isCurrentSession: () => true,
      }),
      runtime.realtimeDocumentService.applyUpdate({
        projectId: project.id,
        documentId: document.id,
        userId: editor.id,
        sessionHandle: secondHandle,
        update: createIncrementalUpdate(baseState, (yDoc) => {
          yDoc.getText("content").insert(4, " strong");
        }),
        isCurrentSession: () => true,
      }),
    ]);

    const persistedState =
      await runtime.documentTextStateRepository.findByDocumentId(document.id);

    expect(persistedState).toMatchObject({
      documentId: document.id,
      version: 3,
    });
    expect(persistedState?.textContent).toContain("Brave ");
    expect(persistedState?.textContent).toContain("strong");

    await firstHandle.leave();
    await secondHandle.leave();
  });
});

function createRuntime() {
  const collaborationService = createCollaborationService();
  const documentRepository = createDocumentRepository(getDb());
  const projectRepository = createProjectRepository(getDb());
  const documentTextStateRepository =
    createDocumentTextStateRepository(getDb());
  const snapshotService = createSnapshotService({
    snapshotRepository: createSnapshotRepository(getDb()),
    snapshotStore: createLocalFilesystemSnapshotStore(
      "/tmp/collabtex-test-snapshots",
    ),
    documentTextStateRepository,
    collaborationService,
    projectStateRepository: createProjectStateRepository(getDb()),
  });
  const currentTextStateService = createCurrentTextStateService({
    documentTextStateRepository,
    snapshotService,
    collaborationService,
  });
  const projectAccessService = createProjectAccessService({
    projectRepository,
  });

  return {
    documentTextStateRepository,
    activeDocumentRegistry: createActiveDocumentRegistry({
      collaborationService,
      loadInitialDocumentState: createActiveDocumentStateLoader({
        documentRepository,
        currentTextStateService,
      }),
      persistOnIdle: async () => {},
    }),
    realtimeDocumentService: createRealtimeDocumentService({
      collaborationService,
      projectAccessService,
      documentRepository,
      currentTextStateService,
    }),
    workspaceService: createWorkspaceService({
      projectAccessService,
      documentRepository,
      currentTextStateService,
    }),
  };
}

async function createUser(email: string) {
  return getDb().user.create({
    data: {
      email,
      name: "Realtime Test User",
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

async function seedTextState(documentId: string, text: string) {
  const collaborationDocument =
    createCollaborationService().createDocumentFromText(text);

  try {
    await createDocumentTextStateRepository(getDb()).create({
      documentId,
      yjsState: collaborationDocument.exportUpdate(),
      textContent: collaborationDocument.getText(),
    });
  } finally {
    collaborationDocument.destroy();
  }
}

function createIncrementalUpdate(
  baseState: Uint8Array,
  mutate: (document: Y.Doc) => void,
) {
  const baseDocument = new Y.Doc();
  const nextDocument = new Y.Doc();

  try {
    Y.applyUpdate(baseDocument, baseState);
    Y.applyUpdate(nextDocument, baseState);
    mutate(nextDocument);

    return Y.encodeStateAsUpdate(
      nextDocument,
      Y.encodeStateVector(baseDocument),
    );
  } finally {
    baseDocument.destroy();
    nextDocument.destroy();
  }
}

function decodeState(state: Uint8Array): string {
  const document = createCollaborationService().createDocumentFromUpdate(state);

  try {
    return document.getText();
  } finally {
    document.destroy();
  }
}
