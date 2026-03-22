import { Router } from "express";
import type { AppConfig } from "../../config/appConfig.js";
import type {
  StoredComment,
  StoredCommentThreadWithComments,
} from "../../services/comment.js";
import {
  CommentAuthorNotFoundError,
  CommentDocumentNotFoundError,
  CommentThreadNotFoundError,
} from "../../services/comment.js";
import type { CommentService } from "../../services/commentService.js";
import {
  ProjectAdminRequiredError,
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "../../services/project.js";
import type { AuthenticatedRequest } from "../../types/express.js";
import { HttpError } from "../errors/httpError.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import {
  isObject,
  parseRequiredTrimmedString,
  parseUuidParam,
} from "../validation/requestValidation.js";

const MAX_ANCHOR_LENGTH = 1024;
const MAX_COMMENT_BODY_LENGTH = 10000;
const MAX_QUOTED_TEXT_LENGTH = 10000;

export function createCommentRouter(
  config: AppConfig,
  commentService: CommentService,
) {
  const router = Router();
  const requireAuth = createRequireAuth(config);

  router.get(
    "/api/projects/:projectId/docs/:docId/comments",
    requireAuth,
    async (req, res, next) => {
      try {
        const authenticatedRequest = req as AuthenticatedRequest;
        const projectId = parseUuidParam(req.params.projectId, "projectId");
        const docId = parseUuidParam(req.params.docId, "docId");

        if (projectId instanceof HttpError) {
          next(projectId);
          return;
        }

        if (docId instanceof HttpError) {
          next(docId);
          return;
        }

        const threads = await commentService.listThreads(
          projectId,
          docId,
          authenticatedRequest.userId,
        );

        res.json({
          threads: threads.map(serializeThread),
        });
      } catch (error) {
        next(mapCommentError(error));
      }
    },
  );

  router.post(
    "/api/projects/:projectId/docs/:docId/comments",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const docId = parseUuidParam(req.params.docId, "docId");
      const body = parseCreateThreadRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (docId instanceof HttpError) {
        next(docId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;

        const thread = await commentService.createThread({
          projectId,
          documentId: docId,
          actorUserId: authenticatedRequest.userId,
          startAnchor: body.startAnchorB64,
          endAnchor: body.endAnchorB64,
          quotedText: body.quotedText,
          body: body.body,
        });

        res.status(201).json({ thread: serializeThread(thread) });
      } catch (error) {
        next(mapCommentError(error));
      }
    },
  );

  router.post(
    "/api/projects/:projectId/threads/:threadId/reply",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const threadId = parseUuidParam(req.params.threadId, "threadId");
      const body = parseReplyRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (threadId instanceof HttpError) {
        next(threadId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;

        const comment = await commentService.replyToThread({
          projectId,
          threadId,
          actorUserId: authenticatedRequest.userId,
          body: body.body,
        });

        res.status(201).json({ comment: serializeComment(comment) });
      } catch (error) {
        next(mapCommentError(error));
      }
    },
  );

  router.patch(
    "/api/projects/:projectId/threads/:threadId",
    requireAuth,
    async (req, res, next) => {
      const projectId = parseUuidParam(req.params.projectId, "projectId");
      const threadId = parseUuidParam(req.params.threadId, "threadId");
      const body = parseUpdateThreadStatusRequest(req.body);

      if (projectId instanceof HttpError) {
        next(projectId);
        return;
      }

      if (threadId instanceof HttpError) {
        next(threadId);
        return;
      }

      if (body instanceof HttpError) {
        next(body);
        return;
      }

      try {
        const authenticatedRequest = req as AuthenticatedRequest;

        const thread = await commentService.updateThreadStatus({
          projectId,
          threadId,
          actorUserId: authenticatedRequest.userId,
          status: body.status,
        });

        res.json({ thread: serializeThread(thread) });
      } catch (error) {
        next(mapCommentError(error));
      }
    },
  );

  return router;
}

const VALID_THREAD_STATUSES = ["open", "resolved"] as const;

type UpdateThreadStatusBody = { status: "open" | "resolved" };

function parseUpdateThreadStatusRequest(
  raw: unknown,
): UpdateThreadStatusBody | HttpError {
  if (!isObject(raw)) {
    return new HttpError(400, "request body must be an object");
  }

  const status = (raw as Record<string, unknown>).status;
  if (
    typeof status !== "string" ||
    !VALID_THREAD_STATUSES.includes(status as "open" | "resolved")
  ) {
    return new HttpError(
      400,
      `status must be one of: ${VALID_THREAD_STATUSES.join(", ")}`,
    );
  }

  return { status: status as "open" | "resolved" };
}

type CreateThreadBody = {
  startAnchorB64: string;
  endAnchorB64: string;
  quotedText: string;
  body: string;
};

function parseCreateThreadRequest(raw: unknown): CreateThreadBody | HttpError {
  if (!isObject(raw)) {
    return new HttpError(400, "request body must be an object");
  }

  const startAnchorB64 = parseRequiredTrimmedString(
    raw.startAnchorB64 as string | undefined,
    "startAnchorB64",
  );
  if (startAnchorB64 instanceof HttpError) return startAnchorB64;
  if (startAnchorB64.length > MAX_ANCHOR_LENGTH) {
    return new HttpError(
      400,
      `startAnchorB64 must be at most ${MAX_ANCHOR_LENGTH} characters`,
    );
  }

  const endAnchorB64 = parseRequiredTrimmedString(
    raw.endAnchorB64 as string | undefined,
    "endAnchorB64",
  );
  if (endAnchorB64 instanceof HttpError) return endAnchorB64;
  if (endAnchorB64.length > MAX_ANCHOR_LENGTH) {
    return new HttpError(
      400,
      `endAnchorB64 must be at most ${MAX_ANCHOR_LENGTH} characters`,
    );
  }

  const rawQuotedText = raw.quotedText as string | undefined;
  if (typeof rawQuotedText !== "string" || rawQuotedText.trim().length === 0) {
    return new HttpError(400, "quotedText is required");
  }
  if (rawQuotedText.length > MAX_QUOTED_TEXT_LENGTH) {
    return new HttpError(
      400,
      `quotedText must be at most ${MAX_QUOTED_TEXT_LENGTH} characters`,
    );
  }
  const quotedText = rawQuotedText;

  const body = parseRequiredTrimmedString(
    raw.body as string | undefined,
    "body",
  );
  if (body instanceof HttpError) return body;
  if (body.length > MAX_COMMENT_BODY_LENGTH) {
    return new HttpError(
      400,
      `body must be at most ${MAX_COMMENT_BODY_LENGTH} characters`,
    );
  }

  return { startAnchorB64, endAnchorB64, quotedText, body };
}

type ReplyBody = { body: string };

function parseReplyRequest(raw: unknown): ReplyBody | HttpError {
  if (!isObject(raw)) {
    return new HttpError(400, "request body must be an object");
  }

  const body = parseRequiredTrimmedString(
    raw.body as string | undefined,
    "body",
  );
  if (body instanceof HttpError) return body;
  if (body.length > MAX_COMMENT_BODY_LENGTH) {
    return new HttpError(
      400,
      `body must be at most ${MAX_COMMENT_BODY_LENGTH} characters`,
    );
  }

  return { body };
}

function mapCommentError(error: unknown): Error {
  if (error instanceof CommentThreadNotFoundError) {
    return new HttpError(404, "comment thread not found");
  }

  if (error instanceof CommentDocumentNotFoundError) {
    return new HttpError(404, "document not found");
  }

  if (error instanceof CommentAuthorNotFoundError) {
    return new HttpError(404, "author not found");
  }

  if (error instanceof ProjectNotFoundError) {
    return new HttpError(404, "project not found");
  }

  if (error instanceof ProjectAdminRequiredError) {
    return new HttpError(403, "admin role required");
  }

  if (error instanceof ProjectRoleRequiredError) {
    return new HttpError(403, "required project role missing");
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown comment error");
}

function serializeThread(thread: StoredCommentThreadWithComments) {
  return {
    id: thread.id,
    documentId: thread.documentId,
    projectId: thread.projectId,
    status: thread.status,
    startAnchor: thread.startAnchor,
    endAnchor: thread.endAnchor,
    quotedText: thread.quotedText,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    comments: thread.comments.map(serializeComment),
  };
}

function serializeComment(comment: StoredComment) {
  return {
    id: comment.id,
    threadId: comment.threadId,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
