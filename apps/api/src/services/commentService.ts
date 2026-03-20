import type {
  CommentRepository,
  StoredComment,
  StoredCommentThreadWithComments,
} from "./comment.js";
import { CommentThreadNotFoundError } from "./comment.js";
import type { ProjectAccessService } from "./projectAccess.js";

const COMMENT_ALLOWED_ROLES = ["admin", "editor", "commenter"] as const;

export type CreateThreadInput = {
  projectId: string;
  documentId: string;
  actorUserId: string;
  startAnchor: string;
  endAnchor: string;
  quotedText: string;
  body: string;
};

export type ReplyToThreadInput = {
  projectId: string;
  threadId: string;
  actorUserId: string;
  body: string;
};

export type CommentService = {
  listThreads: (
    projectId: string,
    documentId: string,
    actorUserId: string,
  ) => Promise<StoredCommentThreadWithComments[]>;
  createThread: (
    input: CreateThreadInput,
  ) => Promise<StoredCommentThreadWithComments>;
  replyToThread: (input: ReplyToThreadInput) => Promise<StoredComment>;
};

export function createCommentService({
  commentRepository,
  projectAccessService,
}: {
  commentRepository: CommentRepository;
  projectAccessService: ProjectAccessService;
}): CommentService {
  return {
    listThreads: async (projectId, documentId, actorUserId) => {
      await projectAccessService.requireProjectMember(projectId, actorUserId);
      return commentRepository.listThreadsForDocument({
        projectId,
        documentId,
      });
    },

    createThread: async (input) => {
      await projectAccessService.requireProjectRole(
        input.projectId,
        input.actorUserId,
        COMMENT_ALLOWED_ROLES,
      );
      return commentRepository.createThread({
        projectId: input.projectId,
        documentId: input.documentId,
        startAnchor: input.startAnchor,
        endAnchor: input.endAnchor,
        quotedText: input.quotedText,
        authorId: input.actorUserId,
        body: input.body,
      });
    },

    replyToThread: async (input) => {
      const thread = await commentRepository.findThreadById(input.threadId);

      if (!thread || thread.projectId !== input.projectId) {
        throw new CommentThreadNotFoundError();
      }

      await projectAccessService.requireProjectRole(
        thread.projectId,
        input.actorUserId,
        COMMENT_ALLOWED_ROLES,
      );

      return commentRepository.addComment({
        threadId: input.threadId,
        authorId: input.actorUserId,
        body: input.body,
      });
    },
  };
}
