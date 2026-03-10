import { Router } from "express";
import type {
  CreateFileRequest,
  DeleteNodeRequest,
  MoveNodeRequest,
  ProjectDocumentResponse,
  RenameNodeRequest,
} from "@collab-tex/shared";
import type { AppConfig } from "../../config/appConfig.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../errors/httpError.js";
import {
  isObject,
  parseRequiredTrimmedString,
  parseUuidParam,
} from "../validation/requestValidation.js";
import {
  DocumentNotFoundError,
  DocumentPathConflictError,
  InvalidDocumentPathError,
  serializeDocument,
  type DocumentService,
} from "../../services/document.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/project.js";

const DOCUMENT_KINDS = ["text", "binary"] as const;

export function createDocumentRouter(
  config: AppConfig,
  documentService: DocumentService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.get(
    "/api/projects/:projectId/tree",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        const nodes = await documentService.getTree(
          projectId,
          authenticatedRequest.userId,
        );

        res.json({ nodes });
      } catch (error) {
        next(mapDocumentError(error));
      }
    },
  );

  router.post(
    "/api/projects/:projectId/files",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const body = parseCreateFileRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const document = await documentService.createFile({
          projectId,
          actorUserId: authenticatedRequest.userId,
          path: body.path,
          kind: body.kind,
          mime: body.mime,
        });

        const response: ProjectDocumentResponse = {
          document: serializeDocument(document),
        };
        res.status(201).json(response);
      } catch (error) {
        next(mapDocumentError(error));
      }
    },
  );

  router.patch(
    "/api/projects/:projectId/nodes/move",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const body = parseMoveNodeRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;

        await documentService.moveNode({
          projectId,
          actorUserId: authenticatedRequest.userId,
          path: body.path,
          destinationParentPath: body.destinationParentPath,
        });

        res.status(204).send();
      } catch (error) {
        next(mapDocumentError(error));
      }
    },
  );

  router.patch(
    "/api/projects/:projectId/nodes/rename",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const body = parseRenameNodeRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;

        await documentService.renameNode({
          projectId,
          actorUserId: authenticatedRequest.userId,
          path: body.path,
          name: body.name,
        });

        res.status(204).send();
      } catch (error) {
        next(mapDocumentError(error));
      }
    },
  );

  router.delete(
    "/api/projects/:projectId/nodes",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const body = parseDeleteNodeRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;

        await documentService.deleteNode({
          projectId,
          actorUserId: authenticatedRequest.userId,
          path: body.path,
        });

        res.status(204).send();
      } catch (error) {
        next(mapDocumentError(error));
      }
    },
  );

  router.get(
    "/api/projects/:projectId/files/content",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");
        const rawPath = req.query.path;
        const path = Array.isArray(rawPath)
          ? new HttpError(
              400,
              "Multiple 'path' query parameters are not allowed.",
            )
          : typeof rawPath === "string" || rawPath === undefined
            ? parseRequiredTrimmedString(rawPath, "path")
            : new HttpError(400, "path must be a string");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (path instanceof HttpError) {
          next(path);
          return;
        }

        const response = await documentService.getFileContent({
          projectId,
          userId: authenticatedRequest.userId,
          path,
        });

        res.json(response);
      } catch (error) {
        next(mapDocumentError(error));
      }
    },
  );

  return router;
}

function parseCreateFileRequest(body: unknown): CreateFileRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const path = parseRequiredBodyString(body.path, "path");
  const kind = parseDocumentKind(body.kind);
  const mime = parseOptionalString(body.mime, "mime");

  if (path instanceof HttpError) {
    return path;
  }

  if (kind instanceof HttpError) {
    return kind;
  }

  if (mime instanceof HttpError) {
    return mime;
  }

  return {
    path,
    kind,
    ...(mime === undefined ? {} : { mime }),
  };
}

function parseMoveNodeRequest(body: unknown): MoveNodeRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const path = parseRequiredBodyString(body.path, "path");

  if (body.destinationParentPath === undefined) {
    return new HttpError(400, "destinationParentPath is required");
  }

  const destinationParentPath = parseNullableString(
    body.destinationParentPath,
    "destinationParentPath",
  );

  if (path instanceof HttpError) {
    return path;
  }

  if (destinationParentPath instanceof HttpError) {
    return destinationParentPath;
  }

  return {
    path,
    destinationParentPath,
  };
}

function parseRenameNodeRequest(body: unknown): RenameNodeRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const path = parseRequiredBodyString(body.path, "path");
  const name = parseRequiredBodyString(body.name, "name");

  if (path instanceof HttpError) {
    return path;
  }

  if (name instanceof HttpError) {
    return name;
  }

  return { path, name };
}

function parseDeleteNodeRequest(body: unknown): DeleteNodeRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const path = parseRequiredBodyString(body.path, "path");

  if (path instanceof HttpError) {
    return path;
  }

  return { path };
}

function parseDocumentKind(value: unknown) {
  if (value === undefined) {
    return new HttpError(400, "kind is required");
  }

  if (typeof value !== "string") {
    return new HttpError(400, "kind must be a string");
  }

  if (DOCUMENT_KINDS.includes(value as (typeof DOCUMENT_KINDS)[number])) {
    return value as CreateFileRequest["kind"];
  }

  return new HttpError(400, `kind must be one of ${DOCUMENT_KINDS.join(", ")}`);
}

function parseRequiredBodyString(
  value: unknown,
  name: string,
): string | HttpError {
  if (value === undefined) {
    return new HttpError(400, `${name} is required`);
  }

  if (typeof value !== "string") {
    return new HttpError(400, `${name} must be a string`);
  }

  return parseRequiredTrimmedString(value, name);
}

function parseOptionalString(
  value: unknown,
  name: string,
): string | undefined | HttpError {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return new HttpError(400, `${name} must be a string`);
  }

  return value.trim();
}

function parseNullableString(
  value: unknown,
  name: string,
): string | null | HttpError {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return new HttpError(400, `${name} must be a string or null`);
  }

  return value.trim();
}

function mapDocumentError(error: unknown): Error {
  if (error instanceof InvalidDocumentPathError) {
    return new HttpError(400, error.message);
  }

  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof DocumentNotFoundError) {
    return new HttpError(404, "document not found");
  }

  if (error instanceof ProjectAdminRequiredError) {
    return new HttpError(403, "admin role required");
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof DocumentPathConflictError) {
    return new HttpError(409, error.message);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown document error");
}
