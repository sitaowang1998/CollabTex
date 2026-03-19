import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../infrastructure/db/client.js";
import { lockActiveProject } from "./projectRepositoryUtils.js";
import {
  CommentDocumentNotFoundError,
  CommentThreadNotFoundError,
  type CommentRepository,
  type StoredComment,
  type StoredCommentThread,
  type StoredCommentThreadWithComments,
} from "../services/comment.js";

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
          include: {
            comments: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        return mapThreadWithComments(thread);
      }),

    listThreadsForDocument: async ({ projectId, documentId }) => {
      const threads = await databaseClient.commentThread.findMany({
        where: {
          projectId,
          documentId,
          project: { tombstoneAt: null },
        },
        include: {
          comments: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
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
          select: { id: true },
        });

        if (!thread) {
          throw new CommentThreadNotFoundError();
        }

        const comment = await tx.comment.create({
          data: {
            threadId,
            authorId,
            body,
          },
        });

        return mapComment(comment);
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

function mapComment(
  row: Prisma.CommentGetPayload<Record<string, never>>,
): StoredComment {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt,
  };
}

function mapThreadWithComments(
  row: Prisma.CommentThreadGetPayload<{ include: { comments: true } }>,
): StoredCommentThreadWithComments {
  return {
    ...mapThread(row),
    comments: row.comments.map(mapComment),
  };
}
