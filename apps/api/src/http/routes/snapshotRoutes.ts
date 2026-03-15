import { Router } from "express";
import type { AppConfig } from "../../config/appConfig.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../errors/httpError.js";
import { parseUuidParam } from "../validation/requestValidation.js";
import {
  InvalidSnapshotDataError,
  SnapshotDataNotFoundError,
  type StoredSnapshot,
} from "../../services/snapshot.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  SnapshotNotFoundError,
  type SnapshotManagementService,
} from "../../services/snapshotManagement.js";

export function createSnapshotRouter(
  config: AppConfig,
  snapshotManagementService: SnapshotManagementService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.get(
    "/api/projects/:projectId/snapshots",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        const snapshots = await snapshotManagementService.listSnapshots({
          projectId,
          userId: authenticatedRequest.userId,
        });

        res.json({
          snapshots: snapshots.map(serializeSnapshot),
        });
      } catch (error) {
        next(mapSnapshotError(error));
      }
    },
  );

  router.post(
    "/api/projects/:projectId/snapshots/:snapshotId/restore",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");
        const snapshotId = parseUuidParam(req.params.snapshotId, "snapshotId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (snapshotId instanceof HttpError) {
          next(snapshotId);
          return;
        }

        const snapshot = await snapshotManagementService.restoreSnapshot({
          projectId,
          snapshotId,
          userId: authenticatedRequest.userId,
        });

        res.json({
          snapshot: serializeSnapshot(snapshot),
        });
      } catch (error) {
        next(mapSnapshotError(error));
      }
    },
  );

  return router;
}

function mapSnapshotError(error: unknown): Error {
  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof SnapshotNotFoundError) {
    return new HttpError(404, "snapshot not found");
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof InvalidSnapshotDataError) {
    return new HttpError(422, error.message);
  }

  if (error instanceof SnapshotDataNotFoundError) {
    return new HttpError(422, "selected snapshot data is missing");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown snapshot error");
}

function serializeSnapshot(snapshot: StoredSnapshot) {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    message: snapshot.message,
    authorId: snapshot.authorId,
    createdAt: snapshot.createdAt.toISOString(),
  };
}
