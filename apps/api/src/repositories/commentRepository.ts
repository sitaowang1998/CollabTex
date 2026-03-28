import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import {
  isPrismaKnownRequestLikeError,
  lockActiveProject,
} from "./projectRepositoryUtils.js";
import {
  CommentAuthorNotFoundError,
  CommentDocumentNotFoundError,
  CommentThreadNotFoundError,
  type CommentRepository,
  type StoredComment,
  type StoredCommentThread,
  type StoredCommentThreadWithComments,
} from "../services/comment.js";

const COMMENT_ORDER_BY: Prisma.CommentOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

const COMMENTS_WITH_AUTHOR = {
  comments: {
    include: { author: { select: { name: true } } },
    orderBy: COMMENT_ORDER_BY,
  },
};

export function createCommentRepository(
  databaseClient: DatabaseClient,
): CommentRepository {
  return {
    createThread: async ({
      projectId,
      documentId,
      startAnchor,
      endAnchor,
      quotedText,
      authorId,
      body,
    }) =>
      databaseClient.$transaction(async (tx) => {
        await lockActiveProject(tx, projectId);

        const document = await tx.document.findFirst({
          where: { id: documentId, projectId },
          select: { id: true },
        });

        if (!document) {
          throw new CommentDocumentNotFoundError();
        }

        try {
          const thread = await tx.commentThread.create({
            data: {
              projectId,
              documentId,
              startAnchor,
              endAnchor,
              quotedText,
              comments: {
                create: {
                  authorId,
                  body,
                },
              },
            },
            include: COMMENTS_WITH_AUTHOR,
          });

          return mapThreadWithComments(thread);
        } catch (error) {
          if (isPrismaKnownRequestLikeError(error) && error.code === "P2003") {
            throw isAuthorFkViolation(error)
              ? new CommentAuthorNotFoundError()
              : new CommentDocumentNotFoundError();
          }

          throw error;
        }
      }),

    listThreadsForProject: async (projectId) => {
      const threads = await databaseClient.commentThread.findMany({
        where: {
          projectId,
          project: { tombstoneAt: null },
        },
        include: COMMENTS_WITH_AUTHOR,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      return threads.map(mapThreadWithComments);
    },

    listThreadsForDocument: async ({ projectId, documentId }) => {
      const threads = await databaseClient.commentThread.findMany({
        where: {
          projectId,
          documentId,
          project: { tombstoneAt: null },
        },
        include: COMMENTS_WITH_AUTHOR,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      return threads.map(mapThreadWithComments);
    },

    addComment: async ({ threadId, authorId, body }) =>
      databaseClient.$transaction(async (tx) => {
        const thread = await tx.commentThread.findFirst({
          where: {
            id: threadId,
            project: { tombstoneAt: null },
          },
          select: { id: true, projectId: true },
        });

        if (!thread) {
          throw new CommentThreadNotFoundError();
        }

        await lockActiveProject(tx, thread.projectId);

        try {
          const comment = await tx.comment.create({
            data: {
              threadId,
              authorId,
              body,
            },
            include: { author: { select: { name: true } } },
          });

          return mapComment(comment);
        } catch (error) {
          if (isPrismaKnownRequestLikeError(error) && error.code === "P2003") {
            throw isAuthorFkViolation(error)
              ? new CommentAuthorNotFoundError()
              : new CommentThreadNotFoundError();
          }

          throw error;
        }
      }),

    findThreadById: async (threadId) => {
      const thread = await databaseClient.commentThread.findFirst({
        where: {
          id: threadId,
          project: { tombstoneAt: null },
        },
      });

      return thread ? mapThread(thread) : null;
    },

    updateThreadStatus: async ({ threadId, status }) =>
      databaseClient.$transaction(async (tx) => {
        const thread = await tx.commentThread.findFirst({
          where: {
            id: threadId,
            project: { tombstoneAt: null },
          },
          select: { id: true, projectId: true },
        });

        if (!thread) {
          throw new CommentThreadNotFoundError();
        }

        await lockActiveProject(tx, thread.projectId);

        try {
          const updated = await tx.commentThread.update({
            where: { id: threadId },
            data: { status },
            include: COMMENTS_WITH_AUTHOR,
          });

          return mapThreadWithComments(updated);
        } catch (error) {
          if (isPrismaKnownRequestLikeError(error) && error.code === "P2025") {
            throw new CommentThreadNotFoundError();
          }

          throw error;
        }
      }),
  };
}

function mapThread(
  row: Prisma.CommentThreadGetPayload<Record<string, never>>,
): StoredCommentThread {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    status: row.status,
    startAnchor: row.startAnchor,
    endAnchor: row.endAnchor,
    quotedText: row.quotedText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type CommentWithAuthor = Prisma.CommentGetPayload<{
  include: { author: { select: { name: true } } };
}>;

function mapComment(row: CommentWithAuthor): StoredComment {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    body: row.body,
    createdAt: row.createdAt,
  };
}

type ThreadWithCommentsAndAuthor = Prisma.CommentThreadGetPayload<{
  include: {
    comments: {
      include: { author: { select: { name: true } } };
    };
  };
}>;

function mapThreadWithComments(
  row: ThreadWithCommentsAndAuthor,
): StoredCommentThreadWithComments {
  return {
    ...mapThread(row),
    comments: row.comments.map(mapComment),
  };
}

function isAuthorFkViolation(error: Error & { code: string }): boolean {
  const meta = (error as unknown as Record<string, unknown>).meta as
    | Record<string, unknown>
    | undefined;
  const fieldName = meta?.field_name as string | undefined;
  if (fieldName) return fieldName.includes("authorId");

  const driverCause = (
    meta?.driverAdapterError as Record<string, unknown> | undefined
  )?.cause as Record<string, unknown> | undefined;
  const constraint = (
    driverCause?.constraint as Record<string, unknown> | undefined
  )?.index as string | undefined;
  if (constraint) return constraint.includes("authorId");

  return false;
}
