import express from "express";
import type { AppConfig } from "../config/appConfig.js";
import type { AuthService } from "../services/auth.js";
import type { DocumentService } from "../services/document.js";
import type { MembershipService } from "../services/membership.js";
import type { ProjectService } from "../services/project.js";
import type { SnapshotManagementService } from "../services/snapshotManagement.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createDocumentRouter } from "./routes/documentRoutes.js";
import { createHealthRouter } from "./routes/healthRoutes.js";
import { createProjectMembershipRouter } from "./routes/projectMembershipRoutes.js";
import { createProjectRouter } from "./routes/projectRoutes.js";
import { createSnapshotRouter } from "./routes/snapshotRoutes.js";

export type HttpAppDependencies = {
  authService: AuthService;
  documentService: DocumentService;
  membershipService: MembershipService;
  projectService: ProjectService;
  snapshotManagementService: SnapshotManagementService;
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
  app.use(createDocumentRouter(config, dependencies.documentService));
  app.use(createSnapshotRouter(config, dependencies.snapshotManagementService));
  app.use(
    createProjectMembershipRouter(config, dependencies.membershipService),
  );
  app.use(errorHandler);

  return app;
}
