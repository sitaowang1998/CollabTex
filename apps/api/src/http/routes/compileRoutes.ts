import { Router } from "express";
import type { AppConfig } from "../../config/appConfig.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/projectAccess.js";
import {
  CompileAlreadyInProgressError,
  CompileMainDocumentNotFoundError,
  type CompileDispatchService,
} from "../../services/compileDispatch.js";
import { HttpError } from "../errors/httpError.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { parseUuidParam } from "../validation/requestValidation.js";

export function createCompileRouter(
  config: AppConfig,
  compileDispatchService: CompileDispatchService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post(
    "/api/projects/:projectId/compile",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const result = await compileDispatchService.compile(
          projectId,
          authenticatedRequest.userId,
        );

        res.json(result);
      } catch (error) {
        next(mapCompileError(error));
      }
    },
  );

  return router;
}

function mapCompileError(error: unknown): Error {
  if (error instanceof CompileAlreadyInProgressError) {
    return new HttpError(409, "compile already in progress");
  }

  if (error instanceof CompileMainDocumentNotFoundError) {
    return new HttpError(400, "no main document found for this project");
  }

  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown compile error");
}
