import express from "express";
import type { AppConfig } from "../config/appConfig.js";
import type { AuthService } from "../services/auth.js";
import type { CommentService } from "../services/commentService.js";
import type { DocumentService } from "../services/document.js";
import type { MembershipService } from "../services/membership.js";
import type { ProjectService } from "../services/project.js";
import type { BinaryContentService } from "../services/binaryContent.js";
import type { CompileDispatchService } from "../services/compileDispatch.js";
import type { CompileRetrievalService } from "../services/compileRetrieval.js";
import type { SnapshotManagementService } from "../services/snapshotManagement.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createCommentRouter } from "./routes/commentRoutes.js";
import type {
  CommentPublisher,
  FileTreePublisher,
} from "../ws/socketServer.js";
import { createCompileRouter } from "./routes/compileRoutes.js";
import { createBinaryContentRouter } from "./routes/binaryContentRoutes.js";
import { createDocumentRouter } from "./routes/documentRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";
import { createProjectMembershipRouter } from "./routes/projectMembershipRoutes.js";
import { createProjectRouter } from "./routes/projectRoutes.js";
import { createSnapshotRouter } from "./routes/snapshotRoutes.js";

export type HttpAppDependencies = {
  authService: AuthService;
  binaryContentService: BinaryContentService;
  commentService: CommentService;
  compileDispatchService: CompileDispatchService;
  compileRetrievalService: CompileRetrievalService;
  documentService: DocumentService;
  membershipService: MembershipService;
  projectService: ProjectService;
  snapshotManagementService: SnapshotManagementService;
  commentPublisherRef: { current: CommentPublisher | undefined };
  fileTreePublisherRef: { current: FileTreePublisher | undefined };
};

export function createHttpApp(
  config: AppConfig,
  dependencies: HttpAppDependencies,
) {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter());
  app.use(createAuthRouter(config, dependencies.authService));
  app.use(createProjectRouter(config, dependencies.projectService));
  app.use(createBinaryContentRouter(config, dependencies.binaryContentService));
  app.use(
    createDocumentRouter(
      config,
      dependencies.documentService,
      dependencies.fileTreePublisherRef,
    ),
  );
  app.use(
    createCompileRouter(
      config,
      dependencies.compileDispatchService,
      dependencies.compileRetrievalService,
    ),
  );
  app.use(
    createSnapshotRouter(
      config,
      dependencies.snapshotManagementService,
      dependencies.fileTreePublisherRef,
    ),
  );
  app.use(
    createProjectMembershipRouter(config, dependencies.membershipService),
  );
  app.use(
    createCommentRouter(
      config,
      dependencies.commentService,
      dependencies.commentPublisherRef,
    ),
  );
  app.use(errorHandler);

  return app;
}
