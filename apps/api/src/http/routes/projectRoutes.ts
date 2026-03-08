import { Router } from "express";
import type {
  CreateProjectRequest,
  Project,
  ProjectSummary,
  UpdateProjectRequest,
} from "@collab-tex/shared";
import { HttpError } from "../errors/httpError.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  type StoredProject,
  type ProjectService,
} from "../../services/project.js";
import type { AppConfig } from "../../config/appConfig.js";
import { createRequireAuth } from "../middleware/requireAuth.js";

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
        const projectId = parseRouteParam(req.params.projectId, "projectId");

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
        const projectId = parseRouteParam(req.params.projectId, "projectId");

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
        const projectId = parseRouteParam(req.params.projectId, "projectId");

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

function isObject(value: unknown): value is Record<string, string | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRouteParam(
  value: string | string[] | undefined,
  name: string,
): string | HttpError {
  if (typeof value !== "string" || !value.trim()) {
    return new HttpError(400, `${name} is required`);
  }

  return value;
}

function mapProjectError(error: unknown): Error {
  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof ProjectAdminRequiredError) {
    return new HttpError(403, "admin role required");
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
