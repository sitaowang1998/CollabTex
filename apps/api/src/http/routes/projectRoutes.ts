import { Router } from "express";
import type {
  CreateProjectRequest,
  MainDocumentResponse,
  Project,
  ProjectSummary,
  UpdateProjectRequest,
} from "@collab-tex/shared";
import { HttpError } from "../errors/httpError.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { isObject, parseUuidParam } from "../validation/requestValidation.js";
import {
  InvalidMainDocumentError,
  ProjectOwnerNotFoundError,
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
  type StoredProject,
  type ProjectService,
} from "../../services/project.js";
import type { AppConfig } from "../../config/appConfig.js";

const MAX_PROJECT_NAME_LENGTH = 160;

export function createProjectRouter(
  config: AppConfig,
  projectService: ProjectService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.post("/api/projects", requireAuth, async (req, res, next) => {
    const body = parseProjectMutationRequest(req.body);

    if (body instanceof HttpError) {
      next(body);
      return;
    }

    try {
      const authenticatedRequest = req as AuthenticatedRequest;
      const project = await projectService.createProject({
        ownerUserId: authenticatedRequest.userId,
        name: body.name,
      });

      res.status(201).json({ project: serializeProject(project) });
    } catch (error) {
      next(mapProjectError(error));
    }
  });

  router.get("/api/projects", requireAuth, async (req, res, next) => {
    try {
      const authenticatedRequest = req as AuthenticatedRequest;
      const projects = await projectService.listProjects(
        authenticatedRequest.userId,
      );

      res.json({
        projects: projects.map(
          ({ project, myRole }): ProjectSummary => ({
            id: project.id,
            name: project.name,
            myRole,
            updatedAt: project.updatedAt.toISOString(),
          }),
        ),
      });
    } catch (error) {
      next(mapProjectError(error));
    }
  });

  router.get(
    "/api/projects/:projectId",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        const project = await projectService.getProject(
          projectId,
          authenticatedRequest.userId,
        );

        res.json({
          project: serializeProject(project.project),
          myRole: project.myRole,
        });
      } catch (error) {
        next(mapProjectError(error));
      }
    },
  );

  router.patch(
    "/api/projects/:projectId",
    requireAuth,
    async (req, res, next) => {
      const body = parseProjectMutationRequest(req.body);

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        const project = await projectService.updateProject({
          projectId,
          userId: authenticatedRequest.userId,
          name: body.name,
        });

        res.json({ project: serializeProject(project) });
      } catch (error) {
        next(mapProjectError(error));
      }
    },
  );

  router.delete(
    "/api/projects/:projectId",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        await projectService.deleteProject({
          projectId,
          userId: authenticatedRequest.userId,
        });

        res.status(204).send();
      } catch (error) {
        next(mapProjectError(error));
      }
    },
  );

  router.get(
    "/api/projects/:projectId/main-document",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        const mainDocument = await projectService.getMainDocument(
          projectId,
          authenticatedRequest.userId,
        );

        const response: MainDocumentResponse = {
          mainDocument: mainDocument
            ? {
                id: mainDocument.id,
                path: mainDocument.path,
                kind: mainDocument.kind,
                mime: mainDocument.mime,
                createdAt: mainDocument.createdAt.toISOString(),
                updatedAt: mainDocument.updatedAt.toISOString(),
              }
            : null,
        };

        res.json(response);
      } catch (error) {
        next(mapProjectError(error));
      }
    },
  );

  router.put(
    "/api/projects/:projectId/main-document",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (!isObject(req.body)) {
          next(new HttpError(400, "request body must be an object"));
          return;
        }

        const documentId = parseUuidParam(
          typeof req.body.documentId === "string"
            ? req.body.documentId
            : undefined,
          "documentId",
        );

        if (documentId instanceof HttpError) {
          next(documentId);
          return;
        }

        await projectService.setMainDocument({
          projectId,
          userId: authenticatedRequest.userId,
          documentId,
        });

        res.status(204).send();
      } catch (error) {
        next(mapProjectError(error));
      }
    },
  );

  return router;
}

function parseProjectMutationRequest(
  body: unknown,
): CreateProjectRequest | UpdateProjectRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return new HttpError(400, "name is required");
  }

  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return new HttpError(
      400,
      `name must be at most ${MAX_PROJECT_NAME_LENGTH} characters`,
    );
  }

  return { name };
}

function mapProjectError(error: unknown): Error {
  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof ProjectAdminRequiredError) {
    return new HttpError(403, "admin role required");
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof InvalidMainDocumentError) {
    return new HttpError(400, error.message);
  }

  if (error instanceof ProjectOwnerNotFoundError) {
    return new HttpError(401, "invalid token");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown project error");
}

function serializeProject(project: StoredProject): Project {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
