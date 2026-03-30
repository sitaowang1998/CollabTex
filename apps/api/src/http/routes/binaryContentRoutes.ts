import { Router, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import type { ProjectDocumentResponse } from "@collab-tex/shared";
import type { AppConfig } from "../../config/appConfig.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../errors/httpError.js";
import {
  parseRequiredTrimmedString,
  parseUuidParam,
} from "../validation/requestValidation.js";
import {
  DocumentNotFoundError,
  DocumentPathConflictError,
  InvalidDocumentPathError,
  serializeDocument,
} from "../../services/document.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/project.js";
import {
  BinaryContentNotFoundError,
  BinaryContentValidationError,
  type BinaryContentService,
} from "../../services/binaryContent.js";
import type { FileTreePublisher } from "../../ws/socketServer.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0 },
});

const uploadWithFields = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 2 },
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

function runUploadWithFields(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadWithFields.single("file")(req, res, (error: unknown) => {
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
  fileTreePublisherRef?: { current: FileTreePublisher | undefined },
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post(
    "/api/projects/:projectId/files/upload",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        await runUploadWithFields(req, res);

        if (!req.file) {
          next(new HttpError(400, "file is required"));
          return;
        }

        const path = parseRequiredTrimmedString(
          req.body?.path as string | undefined,
          "path",
        );

        if (path instanceof HttpError) {
          next(path);
          return;
        }

        const mime =
          typeof req.body?.mime === "string" && req.body.mime.trim()
            ? req.body.mime.trim()
            : req.file.mimetype || "application/octet-stream";

        const document = await binaryContentService.createBinaryFile({
          projectId,
          actorUserId: authenticatedRequest.userId,
          path,
          mime,
          content: req.file.buffer,
        });

        fileTreePublisherRef?.current?.emitTreeChanged({ projectId });

        const response: ProjectDocumentResponse = {
          document: serializeDocument(document),
        };
        res.status(201).json(response);
      } catch (error) {
        next(mapBinaryContentError(error));
      }
    },
  );

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

  router.get(
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

        const content = await binaryContentService.downloadContent({
          projectId,
          actorUserId: authenticatedRequest.userId,
          fileId,
        });

        res.contentType("application/octet-stream").send(content);
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

  if (error instanceof InvalidDocumentPathError) {
    return new HttpError(400, error.message);
  }

  if (error instanceof BinaryContentValidationError) {
    return new HttpError(400, error.message);
  }

  if (error instanceof BinaryContentNotFoundError) {
    return new HttpError(404, "binary content not found");
  }

  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof DocumentNotFoundError) {
    return new HttpError(404, "document not found");
  }

  if (error instanceof DocumentPathConflictError) {
    return new HttpError(409, error.message);
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown binary content error");
}
