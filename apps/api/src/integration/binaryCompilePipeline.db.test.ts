import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { createLocalFilesystemSnapshotStore } from "../infrastructure/storage/localFilesystemSnapshotStore.js";
import { createLocalFilesystemBinaryContentStore } from "../infrastructure/storage/localFilesystemBinaryContentStore.js";
import { createLocalFilesystemCompileStore } from "../infrastructure/storage/localFilesystemCompileStore.js";
import { createDockerCompileAdapter } from "../infrastructure/compile/dockerCompileAdapter.js";
import { createDocumentRepository } from "../repositories/documentRepository.js";
import { createDocumentTextStateRepository } from "../repositories/documentTextStateRepository.js";
import { createProjectRepository } from "../repositories/projectRepository.js";
import { createProjectStateRepository } from "../repositories/projectStateRepository.js";
import { createSnapshotRepository } from "../repositories/snapshotRepository.js";
import { createCompileBuildRepository } from "../repositories/compileBuildRepository.js";
import { createCollaborationService } from "../services/collaboration.js";
import { createSnapshotService } from "../services/snapshot.js";
import { createProjectAccessService } from "../services/projectAccess.js";
import { createProjectService } from "../services/project.js";
import { createDocumentService } from "../services/document.js";
import { createSnapshotRefreshTrigger } from "../services/snapshotRefresh.js";
import {
  createCompileDispatchService,
  type CompileDispatchResult,
} from "../services/compileDispatch.js";
import {
  assembleProjectFiles,
  type ExportedFile,
  type FileAssemblyDependencies,
} from "../services/workspaceExport.js";
import type { CompileDoneEvent } from "@collab-tex/shared";
import { createTestDatabaseClient } from "../test/db/createTestDatabaseClient.js";
import { BinaryContentNotFoundError } from "../services/binaryContent.js";

// -- Test fixtures --

// Single-pass pdflatex source (no bibliography — that requires bibtex)
const MAIN_TEX_V1 = `\\documentclass{article}
\\usepackage{graphicx}
\\begin{document}
\\section{Main Document}
\\input{chapters/intro}
\\includegraphics[width=1cm]{figures/logo.png}
\\end{document}
`;

const MAIN_TEX_V2 = `\\documentclass{article}
\\usepackage{graphicx}
\\begin{document}
\\section{Main Document V2}
\\input{chapters/intro}
\\includegraphics[width=1cm]{figures/logo.png}
\\includegraphics[width=1cm]{figures/diagram.jpg}
\\end{document}
`;

const INTRO_TEX_V1 = `\\section{Introduction}
This is the first version of the introduction.
`;

const INTRO_TEX_V2 = `\\section{Introduction}
This is the updated introduction with more detail.
`;

const REFS_BIB = `@article{test2026,
  author = {Test Author},
  title = {Test Title},
  journal = {Test Journal},
  year = {2026}
}
`;

const REPORT_TEX = `\\documentclass{article}
\\begin{document}
\\section{Report Entrypoint}
This is a separate main document.
\\end{document}
`;

// Valid 1x1 PNGs generated with correct zlib compression
const LOGO_PNG_V1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

const LOGO_PNG_V2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
  "base64",
);

// Valid 1x1 JPEG
const DIAGRAM_JPG = createMinimalJpeg();

// -- DB setup --

let db: DatabaseClient | undefined;

function getDb(): DatabaseClient {
  if (!db) {
    throw new Error("Test database client not initialized");
  }
  return db;
}

// -- PDF verification helpers --

function extractPdfText(pdfBuffer: Buffer): string {
  const pdfString = pdfBuffer.toString("binary");
  const parts: string[] = [];

  // Extract text from compressed streams (FlateDecode)
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamRegex.exec(pdfString)) !== null) {
    try {
      const rawStream = Buffer.from(match[1]!, "binary");
      const decompressed = inflateSync(rawStream).toString("latin1");
      // Extract text between BT..ET blocks (PDF text objects)
      const textBlocks = decompressed.match(/BT[\s\S]*?ET/g) ?? [];
      for (const block of textBlocks) {
        // Extract parenthesized strings: (text here)
        const strings = block.match(/\(([^)]*)\)/g) ?? [];
        parts.push(...strings.map((s) => s.slice(1, -1)));
      }
    } catch {
      // Not a zlib stream or decompression failed — skip
    }
  }

  return parts.join(" ");
}

function assertPdfContainsText(
  pdfBuffer: Buffer,
  expectedTexts: string[],
): void {
  // pdflatex inserts kerning spaces and ligature characters, so we
  // strip spaces and control chars from both sides for comparison
  // eslint-disable-next-line no-control-regex
  const text = extractPdfText(pdfBuffer).replace(/[\s\x00-\x1f]+/g, "");

  for (const expected of expectedTexts) {
    const normalizedExpected = expected.replace(/\s+/g, "");
    expect(text).toContain(normalizedExpected);
  }
}

function assertPdfContainsImages(pdfBuffer: Buffer): void {
  const pdfString = pdfBuffer.toString("binary");
  expect(pdfString).toContain("/Subtype /Image");
}

// -- Main test --

describe("binary compile pipeline integration", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    db = createTestDatabaseClient();
    await db.$connect();
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "collabtex-pipeline-test-"));
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it(
    "exercises the full project lifecycle: create, compile, modify, restore, recompile, change main",
    { timeout: 300000 },
    async () => {
      const suffix = randomUUID();
      const snapshotRoot = path.join(tmpRoot, "snapshots");
      const binaryRoot = path.join(tmpRoot, "binary");
      const compileRoot = path.join(tmpRoot, "compiles");

      // -- Infrastructure (all real, no mocks) --
      const documentRepository = createDocumentRepository(getDb());
      const documentTextStateRepository =
        createDocumentTextStateRepository(getDb());
      const projectRepository = createProjectRepository(getDb());
      const snapshotRepository = createSnapshotRepository(getDb());
      const snapshotStore = createLocalFilesystemSnapshotStore(snapshotRoot);
      const binaryContentStore =
        createLocalFilesystemBinaryContentStore(binaryRoot);
      const compileArtifactStore =
        createLocalFilesystemCompileStore(compileRoot);
      const compileBuildRepository = createCompileBuildRepository(getDb());
      const collaborationService = createCollaborationService();
      const projectStateRepository = createProjectStateRepository(getDb());
      const projectAccessService = createProjectAccessService({
        projectRepository,
      });
      const compileAdapter = createDockerCompileAdapter();

      const snapshotService = createSnapshotService({
        snapshotRepository,
        snapshotStore,
        documentTextStateRepository,
        collaborationService,
        projectStateRepository,
        binaryContentStore,
        documentLookup: documentRepository,
        commentThreadLookup: {
          listThreadsForProject: async () => [],
        },
      });

      const snapshotRefreshTrigger = createSnapshotRefreshTrigger({
        snapshotRefreshProcessor: {
          processNextJob: async () => false,
        },
      });

      const projectService = createProjectService({
        projectRepository,
        documentLookup: documentRepository,
        projectAccessService,
      });

      const documentService = createDocumentService({
        documentRepository,
        projectAccessService,
        snapshotService,
        snapshotRefreshTrigger,
        binaryContentStore,
      });

      const compileDoneEvents: CompileDoneEvent[] = [];
      const compileDispatchService = createCompileDispatchService({
        projectAccessService,
        projectService,
        fileAssemblyDeps: {
          documentRepository,
          documentTextStateRepository,
          snapshotRepository,
          snapshotStore,
          binaryContentStore,
        },
        compileAdapter,
        compileArtifactStore,
        compileBuildRepository,
        compileTimeoutMs: 120000,
        notifyCompileDone: (event) => compileDoneEvents.push(event),
        queueProjectSnapshot: async () => {},
      });

      const fileAssemblyDeps: FileAssemblyDependencies = {
        documentRepository,
        documentTextStateRepository,
        snapshotRepository,
        snapshotStore,
        binaryContentStore,
      };

      // -- Helpers --
      async function compile(): Promise<CompileDispatchResult> {
        return compileDispatchService.compile(project.id, owner.id);
      }

      async function getAssembledFiles(): Promise<ExportedFile[]> {
        return assembleProjectFiles(fileAssemblyDeps, project.id);
      }

      function assertFileMap(
        files: ExportedFile[],
        expected: Record<string, string | Buffer>,
      ): void {
        const actualKeys = files.map((f) => f.relativePath).sort();
        const expectedKeys = Object.keys(expected).sort();
        expect(actualKeys).toEqual(expectedKeys);

        for (const file of files) {
          const expectedContent = expected[file.relativePath];
          expect(expectedContent).toBeDefined();
          if (file.kind === "text") {
            expect(typeof expectedContent).toBe("string");
            expect(file.content).toBe(expectedContent);
          } else {
            expect(Buffer.isBuffer(expectedContent)).toBe(true);
            expect(file.content).toEqual(expectedContent);
          }
        }
      }

      async function assertCompileArtifactStored(): Promise<Buffer> {
        const buildPath = await compileBuildRepository.getLatestBuildPath(
          project.id,
        );
        expect(buildPath).not.toBeNull();
        const pdf = await compileArtifactStore.readPdf(buildPath!);
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(pdf.length).toBeGreaterThan(1000);
        return pdf;
      }

      // -- Create project and user --
      const owner = await getDb().user.create({
        data: {
          email: `pipeline-${suffix}@example.com`,
          name: "Pipeline Test User",
          passwordHash: "hash",
        },
      });
      const project = await getDb().project.create({
        data: { name: `Pipeline Test ${suffix}` },
      });
      await getDb().projectMembership.create({
        data: {
          projectId: project.id,
          userId: owner.id,
          role: "admin",
        },
      });

      // ========================================
      // Scenario 1: Initial setup + first compile
      // ========================================

      const mainDoc = await documentRepository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/main.tex",
        kind: "text",
        mime: "text/x-tex",
      });
      const introDoc = await documentRepository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/chapters/intro.tex",
        kind: "text",
        mime: "text/x-tex",
      });
      const bibDoc = await documentRepository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/refs.bib",
        kind: "text",
        mime: null,
      });
      const logoDoc = await documentRepository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/figures/logo.png",
        kind: "binary",
        mime: "image/png",
      });

      await documentTextStateRepository.create({
        documentId: mainDoc.id,
        ...createTextState(collaborationService, MAIN_TEX_V1),
      });
      await documentTextStateRepository.create({
        documentId: introDoc.id,
        ...createTextState(collaborationService, INTRO_TEX_V1),
      });
      await documentTextStateRepository.create({
        documentId: bibDoc.id,
        ...createTextState(collaborationService, REFS_BIB),
      });
      await binaryContentStore.put(`${project.id}/${logoDoc.id}`, LOGO_PNG_V1);

      // Verify file map
      const files1 = await getAssembledFiles();
      assertFileMap(files1, {
        "main.tex": MAIN_TEX_V1,
        "chapters/intro.tex": INTRO_TEX_V1,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V1,
      });

      // Compile and verify PDF
      const result1 = await compile();
      expect(result1.status).toBe("success");
      const pdf1 = await assertCompileArtifactStored();
      assertPdfContainsText(pdf1, ["Main Document", "Introduction"]);
      assertPdfContainsImages(pdf1);

      // ========================================
      // Scenario 2: Add diagram, modify main, capture S1
      // ========================================

      const diagramDoc = await documentRepository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/figures/diagram.jpg",
        kind: "binary",
        mime: "image/jpeg",
      });
      await binaryContentStore.put(
        `${project.id}/${diagramDoc.id}`,
        DIAGRAM_JPG,
      );
      await documentTextStateRepository.update({
        documentId: mainDoc.id,
        ...createTextState(collaborationService, MAIN_TEX_V2),
      });

      const allDocsForS1 = await documentRepository.listForProject(project.id);
      const s1 = await snapshotService.captureProjectSnapshot({
        projectId: project.id,
        authorId: owner.id,
        documents: allDocsForS1,
        message: "S1: complete project with diagram",
      });

      const files2 = await getAssembledFiles();
      assertFileMap(files2, {
        "main.tex": MAIN_TEX_V2,
        "chapters/intro.tex": INTRO_TEX_V1,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V1,
        "figures/diagram.jpg": DIAGRAM_JPG,
      });

      const result2 = await compile();
      expect(result2.status).toBe("success");
      const pdf2 = await assertCompileArtifactStored();
      assertPdfContainsText(pdf2, ["Main Document V2"]);
      assertPdfContainsImages(pdf2);

      // ========================================
      // Scenario 3: Modify text + replace logo, capture S2
      // ========================================

      await documentTextStateRepository.update({
        documentId: introDoc.id,
        ...createTextState(collaborationService, INTRO_TEX_V2),
      });
      await binaryContentStore.put(`${project.id}/${logoDoc.id}`, LOGO_PNG_V2);

      const allDocsForS2 = await documentRepository.listForProject(project.id);
      const s2 = await snapshotService.captureProjectSnapshot({
        projectId: project.id,
        authorId: owner.id,
        documents: allDocsForS2,
        message: "S2: updated intro + new logo",
      });

      const files3 = await getAssembledFiles();
      assertFileMap(files3, {
        "main.tex": MAIN_TEX_V2,
        "chapters/intro.tex": INTRO_TEX_V2,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V2,
        "figures/diagram.jpg": DIAGRAM_JPG,
      });

      const result3 = await compile();
      expect(result3.status).toBe("success");
      const pdf3 = await assertCompileArtifactStored();
      assertPdfContainsText(pdf3, ["updated introduction"]);

      // ========================================
      // Scenario 4: Restore to S1, verify state, compile
      // ========================================

      await snapshotService.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: s1.id,
        actorUserId: owner.id,
      });

      // Verify binary store has S1 content
      const logoAfterS1 = await binaryContentStore.get(
        `${project.id}/${logoDoc.id}`,
      );
      expect(logoAfterS1).toEqual(LOGO_PNG_V1);

      const introAfterS1 = await documentTextStateRepository.findByDocumentId(
        introDoc.id,
      );
      expect(introAfterS1?.textContent).toBe(INTRO_TEX_V1);

      const files4 = await getAssembledFiles();
      assertFileMap(files4, {
        "main.tex": MAIN_TEX_V2,
        "chapters/intro.tex": INTRO_TEX_V1,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V1,
        "figures/diagram.jpg": DIAGRAM_JPG,
      });

      const result4 = await compile();
      expect(result4.status).toBe("success");
      const pdf4 = await assertCompileArtifactStored();
      assertPdfContainsText(pdf4, ["version of the introduction"]);
      assertPdfContainsImages(pdf4);

      // ========================================
      // Scenario 5: Restore to S2 (revert the revert), compile
      // ========================================

      await snapshotService.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: s2.id,
        actorUserId: owner.id,
      });

      const logoAfterS2 = await binaryContentStore.get(
        `${project.id}/${logoDoc.id}`,
      );
      expect(logoAfterS2).toEqual(LOGO_PNG_V2);

      const files5 = await getAssembledFiles();
      assertFileMap(files5, {
        "main.tex": MAIN_TEX_V2,
        "chapters/intro.tex": INTRO_TEX_V2,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V2,
        "figures/diagram.jpg": DIAGRAM_JPG,
      });

      const result5 = await compile();
      expect(result5.status).toBe("success");
      const pdf5 = await assertCompileArtifactStored();
      assertPdfContainsText(pdf5, ["updated introduction"]);

      // ========================================
      // Scenario 6: Delete diagram, compile with fewer files
      // ========================================

      await documentService.deleteNode({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/figures/diagram.jpg",
      });

      await expect(
        binaryContentStore.get(`${project.id}/${diagramDoc.id}`),
      ).rejects.toBeInstanceOf(BinaryContentNotFoundError);

      // Update main.tex to remove diagram reference before capturing S3
      await documentTextStateRepository.update({
        documentId: mainDoc.id,
        ...createTextState(collaborationService, MAIN_TEX_V1),
      });

      const allDocsForS3 = await documentRepository.listForProject(project.id);
      const s3 = await snapshotService.captureProjectSnapshot({
        projectId: project.id,
        authorId: owner.id,
        documents: allDocsForS3,
        message: "S3: diagram deleted, main updated",
      });

      const files6 = await getAssembledFiles();
      assertFileMap(files6, {
        "main.tex": MAIN_TEX_V1,
        "chapters/intro.tex": INTRO_TEX_V2,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V2,
      });

      const result6 = await compile();
      expect(result6.status).toBe("success");

      // ========================================
      // Scenario 7: Restore to S2 (before deletion), compile
      // ========================================

      await snapshotService.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: s2.id,
        actorUserId: owner.id,
      });

      const diagramAfterRestore = await binaryContentStore.get(
        `${project.id}/${diagramDoc.id}`,
      );
      expect(diagramAfterRestore).toEqual(DIAGRAM_JPG);

      const files7 = await getAssembledFiles();
      assertFileMap(files7, {
        "main.tex": MAIN_TEX_V2,
        "chapters/intro.tex": INTRO_TEX_V2,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V2,
        "figures/diagram.jpg": DIAGRAM_JPG,
      });

      const result7 = await compile();
      expect(result7.status).toBe("success");
      const pdf7 = await assertCompileArtifactStored();
      assertPdfContainsImages(pdf7);

      // ========================================
      // Scenario 8: Restore to S3 (after deletion), compile
      // ========================================

      await snapshotService.restoreProjectSnapshot({
        projectId: project.id,
        snapshotId: s3.id,
        actorUserId: owner.id,
      });

      await expect(
        binaryContentStore.get(`${project.id}/${diagramDoc.id}`),
      ).rejects.toBeInstanceOf(BinaryContentNotFoundError);

      // S3 was captured with MAIN_TEX_V1 (no diagram ref), so restore
      // should set main.tex back to V1 automatically
      const files8 = await getAssembledFiles();
      assertFileMap(files8, {
        "main.tex": MAIN_TEX_V1,
        "chapters/intro.tex": INTRO_TEX_V2,
        "refs.bib": REFS_BIB,
        "figures/logo.png": LOGO_PNG_V2,
      });

      const result8 = await compile();
      expect(result8.status).toBe("success");

      // ========================================
      // Scenario 9: Change main document, compile
      // ========================================

      const reportDoc = await documentRepository.createDocument({
        projectId: project.id,
        actorUserId: owner.id,
        path: "/report.tex",
        kind: "text",
        mime: "text/x-tex",
      });
      await documentTextStateRepository.create({
        documentId: reportDoc.id,
        ...createTextState(collaborationService, REPORT_TEX),
      });

      await projectService.setMainDocument({
        projectId: project.id,
        userId: owner.id,
        documentId: reportDoc.id,
      });

      const result9 = await compile();
      expect(result9.status).toBe("success");
      const pdf9 = await assertCompileArtifactStored();
      assertPdfContainsText(pdf9, ["Report Entrypoint"]);

      // Switch back to main.tex
      await projectService.setMainDocument({
        projectId: project.id,
        userId: owner.id,
        documentId: mainDoc.id,
      });

      const result9b = await compile();
      expect(result9b.status).toBe("success");
      const pdf9b = await assertCompileArtifactStored();
      assertPdfContainsText(pdf9b, ["Main Document"]);

      // ========================================
      // Scenario 10: Fallback to /main.tex
      // ========================================

      await getDb().project.update({
        where: { id: project.id },
        data: { mainDocumentId: null },
      });

      const result10 = await compile();
      expect(result10.status).toBe("success");

      // ========================================
      // Verify compile:done events
      // ========================================

      // 10 scenarios, scenario 9 has 2 compiles = 11 total
      expect(compileDoneEvents).toHaveLength(11);
      for (const event of compileDoneEvents) {
        expect(event.projectId).toBe(project.id);
        expect(event.status).toBe("success");
      }
    },
  );
});

function createTextState(
  collaborationService: ReturnType<typeof createCollaborationService>,
  text: string,
) {
  const document = collaborationService.createDocumentFromText(text);

  try {
    return {
      yjsState: document.exportUpdate(),
      textContent: document.getText(),
    };
  } finally {
    document.destroy();
  }
}

function createMinimalJpeg(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const dqt = Buffer.from([
    0xff,
    0xdb,
    0x00,
    0x43,
    0x00,
    ...new Array(64).fill(1),
  ]);
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00,
  ]);
  const dht = Buffer.from([
    0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
    0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
  ]);
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x40,
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, dqt, sof, dht, sos, eoi]);
}
