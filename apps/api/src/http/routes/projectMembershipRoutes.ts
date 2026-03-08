import { Router } from "express";
import type {
  AddProjectMemberRequest,
  ProjectMember,
  ProjectMemberResponse,
  UpdateProjectMemberRequest,
} from "@collab-tex/shared";
import type { AppConfig } from "../../config/appConfig.js";
import {
  DuplicateProjectMembershipError,
  LastProjectAdminRemovalError,
  MembershipUserNotFoundError,
  ProjectAdminOrSelfRequiredError,
  ProjectMembershipNotFoundError,
  type MembershipService,
} from "../../services/membership.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
} from "../../services/project.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { HttpError } from "../errors/httpError.js";
import { createRequireAuth } from "../middleware/requireAuth.js";

const PROJECT_ROLES = ["admin", "editor", "commenter", "reader"] as const;

export function createProjectMembershipRouter(
  config: AppConfig,
  membershipService: MembershipService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.get(
    "/api/projects/:projectId/members",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseRouteParam(req.params.projectId, "projectId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        const members = await membershipService.listMembers(
          projectId,
          authenticatedRequest.userId,
        );

        res.json({
          members: members.map(serializeMember),
        });
      } catch (error) {
        next(mapMembershipError(error));
      }
    },
  );

  router.post(
    "/api/projects/:projectId/members",
    requireAuth,
    async (req, res, next) => {
      const body = parseAddProjectMemberRequest(req.body);

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

        const member = await membershipService.addMember({
          projectId,
          actorUserId: authenticatedRequest.userId,
          email: body.email,
          role: body.role,
        });

        res.status(201).json({ member: serializeMember(member) });
      } catch (error) {
        next(mapMembershipError(error));
      }
    },
  );

  router.patch(
    "/api/projects/:projectId/members/:userId",
    requireAuth,
    async (req, res, next) => {
      const body = parseUpdateProjectMemberRequest(req.body);

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseRouteParam(req.params.projectId, "projectId");
        const userId = parseRouteParam(req.params.userId, "userId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (userId instanceof HttpError) {
          next(userId);
          return;
        }

        const member = await membershipService.updateMemberRole({
          projectId,
          actorUserId: authenticatedRequest.userId,
          targetUserId: userId,
          role: body.role,
        });

        res.json({ member: serializeMember(member) });
      } catch (error) {
        next(mapMembershipError(error));
      }
    },
  );

  router.delete(
    "/api/projects/:projectId/members/:userId",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseRouteParam(req.params.projectId, "projectId");
        const userId = parseRouteParam(req.params.userId, "userId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (userId instanceof HttpError) {
          next(userId);
          return;
        }

        await membershipService.deleteMember({
          projectId,
          actorUserId: authenticatedRequest.userId,
          targetUserId: userId,
        });

        res.status(204).send();
      } catch (error) {
        next(mapMembershipError(error));
      }
    },
  );

  return router;
}

function parseAddProjectMemberRequest(
  body: unknown,
): AddProjectMemberRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = parseRole(body.role);

  if (!email) {
    return new HttpError(400, "email is required");
  }

  if (role instanceof HttpError) {
    return role;
  }

  return { email, role };
}

function parseUpdateProjectMemberRequest(
  body: unknown,
): UpdateProjectMemberRequest | HttpError {
  if (!isObject(body)) {
    return new HttpError(400, "request body must be an object");
  }

  const role = parseRole(body.role);

  if (role instanceof HttpError) {
    return role;
  }

  return { role };
}

function parseRole(value: unknown) {
  if (typeof value !== "string") {
    return new HttpError(400, "role is required");
  }

  if (PROJECT_ROLES.includes(value as (typeof PROJECT_ROLES)[number])) {
    return value as ProjectMember["role"];
  }

  return new HttpError(400, `role must be one of ${PROJECT_ROLES.join(", ")}`);
}

function parseRouteParam(
  value: string | string[] | undefined,
  name: string,
): string | HttpError {
  if (typeof value !== "string") {
    return new HttpError(400, `${name} is required`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return new HttpError(400, `${name} is required`);
  }

  return trimmed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapMembershipError(error: unknown): Error {
  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof ProjectAdminRequiredError) {
    return new HttpError(403, "admin role required");
  }

  if (error instanceof ProjectAdminOrSelfRequiredError) {
    return new HttpError(403, "admin role or self removal required");
  }

  if (error instanceof MembershipUserNotFoundError) {
    return new HttpError(404, "user not found");
  }

  if (error instanceof ProjectMembershipNotFoundError) {
    return new HttpError(404, "project membership not found");
  }

  if (error instanceof DuplicateProjectMembershipError) {
    return new HttpError(409, "project membership already exists");
  }

  if (error instanceof LastProjectAdminRemovalError) {
    return new HttpError(409, "cannot remove the last admin");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown membership error");
}

function serializeMember(
  member: ProjectMember,
): ProjectMemberResponse["member"] {
  return {
    userId: member.userId,
    email: member.email,
    name: member.name,
    role: member.role,
  };
}
