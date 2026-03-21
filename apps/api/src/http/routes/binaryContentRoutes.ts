import { Router, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import type { AppConfig } from "../../config/appConfig.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../errors/httpError.js";
import { parseUuidParam } from "../validation/requestValidation.js";
import { DocumentNotFoundError } from "../../services/document.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/project.js";
import {
  BinaryContentValidationError,
  type BinaryContentService,
} from "../../services/binaryContent.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0 },
});

function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function createBinaryContentRouter(
  config: AppConfig,
  binaryContentService: BinaryContentService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post(
    "/api/projects/:projectId/files/:fileId/content",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");
        const fileId = parseUuidParam(req.params.fileId, "fileId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (fileId instanceof HttpError) {
          next(fileId);
          return;
        }

        await runUpload(req, res);

        if (!req.file) {
          next(new HttpError(400, "file is required"));
          return;
        }

        await binaryContentService.uploadContent({
          projectId,
          actorUserId: authenticatedRequest.userId,
          fileId,
          content: req.file.buffer,
        });

        res.status(204).send();
      } catch (error) {
        next(mapBinaryContentError(error));
      }
    },
  );

  return router;
}

function mapBinaryContentError(error: unknown): Error {
  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new HttpError(413, "file exceeds maximum size of 50 MB");
    }

    return new HttpError(400, `upload error: ${error.message}`);
  }

  if (error instanceof BinaryContentValidationError) {
    return new HttpError(400, error.message);
  }

  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof DocumentNotFoundError) {
    return new HttpError(404, "document not found");
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown binary content error");
}
