import { describe, expect, it, vi } from "vitest";
import {
  CommentAuthorNotFoundError,
  CommentDocumentNotFoundError,
  CommentThreadNotFoundError,
  type CommentRepository,
  type StoredComment,
  type StoredCommentThread,
  type StoredCommentThreadWithComments,
} from "./comment.js";
import { createCommentService } from "./commentService.js";
import type { ProjectAccessService, ProjectWithRole } from "./projectAccess.js";
import {
  ProjectNotFoundError,
  ProjectRoleRequiredError,
} from "./projectAccess.js";

describe("comment service", () => {
  describe("listThreads", () => {
    it("lists threads after verifying membership", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      const threads = [createThreadWithComments()];
      projectAccessService.requireProjectMember.mockResolvedValue(
        createProjectWithRole("reader"),
      );
      commentRepository.listThreadsForDocument.mockResolvedValue(threads);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      const result = await service.listThreads(
        "project-1",
        "document-1",
        "user-1",
      );

      expect(result).toBe(threads);
      expect(projectAccessService.requireProjectMember).toHaveBeenCalledWith(
        "project-1",
        "user-1",
      );
      expect(commentRepository.listThreadsForDocument).toHaveBeenCalledWith({
        projectId: "project-1",
        documentId: "document-1",
      });
    });

    it("rejects when user is not a project member", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      projectAccessService.requireProjectMember.mockRejectedValue(
        new ProjectNotFoundError(),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.listThreads("project-1", "document-1", "user-1"),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
      expect(commentRepository.listThreadsForDocument).not.toHaveBeenCalled();
    });

    it("returns quotedText in each thread", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      const threads = [
        createThreadWithComments({ quotedText: "selected text" }),
      ];
      projectAccessService.requireProjectMember.mockResolvedValue(
        createProjectWithRole("reader"),
      );
      commentRepository.listThreadsForDocument.mockResolvedValue(threads);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      const result = await service.listThreads(
        "project-1",
        "document-1",
        "user-1",
      );

      expect(result[0]?.quotedText).toBe("selected text");
    });
  });

  describe("createThread", () => {
    it("creates thread with first comment for authorized role", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      const created = createThreadWithComments();
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("commenter"),
      );
      commentRepository.createThread.mockResolvedValue(created);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      const result = await service.createThread({
        projectId: "project-1",
        documentId: "document-1",
        actorUserId: "user-1",
        startAnchor: "anchor-start",
        endAnchor: "anchor-end",
        quotedText: "quoted",
        body: "first comment",
      });

      expect(result).toBe(created);
      expect(projectAccessService.requireProjectRole).toHaveBeenCalledWith(
        "project-1",
        "user-1",
        ["admin", "editor", "commenter"],
      );
      expect(commentRepository.createThread).toHaveBeenCalledWith({
        projectId: "project-1",
        documentId: "document-1",
        startAnchor: "anchor-start",
        endAnchor: "anchor-end",
        quotedText: "quoted",
        authorId: "user-1",
        body: "first comment",
      });
    });

    it("rejects for reader role", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      projectAccessService.requireProjectRole.mockRejectedValue(
        new ProjectRoleRequiredError(["admin", "editor", "commenter"]),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.createThread({
          projectId: "project-1",
          documentId: "document-1",
          actorUserId: "user-1",
          startAnchor: "a",
          endAnchor: "b",
          quotedText: "q",
          body: "body",
        }),
      ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
      expect(commentRepository.createThread).not.toHaveBeenCalled();
    });

    it("passes through CommentDocumentNotFoundError from repository", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("editor"),
      );
      commentRepository.createThread.mockRejectedValue(
        new CommentDocumentNotFoundError(),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.createThread({
          projectId: "project-1",
          documentId: "missing-doc",
          actorUserId: "user-1",
          startAnchor: "a",
          endAnchor: "b",
          quotedText: "q",
          body: "body",
        }),
      ).rejects.toBeInstanceOf(CommentDocumentNotFoundError);
    });

    it("passes through CommentAuthorNotFoundError from repository", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("editor"),
      );
      commentRepository.createThread.mockRejectedValue(
        new CommentAuthorNotFoundError(),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.createThread({
          projectId: "project-1",
          documentId: "document-1",
          actorUserId: "deleted-user",
          startAnchor: "a",
          endAnchor: "b",
          quotedText: "q",
          body: "body",
        }),
      ).rejects.toBeInstanceOf(CommentAuthorNotFoundError);
    });

    it("includes quotedText in created thread response", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      const created = createThreadWithComments({
        quotedText: "the selected text",
      });
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("admin"),
      );
      commentRepository.createThread.mockResolvedValue(created);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      const result = await service.createThread({
        projectId: "project-1",
        documentId: "document-1",
        actorUserId: "user-1",
        startAnchor: "a",
        endAnchor: "b",
        quotedText: "the selected text",
        body: "body",
      });

      expect(result.quotedText).toBe("the selected text");
    });
  });

  describe("replyToThread", () => {
    it("replies to existing thread after role check on the thread's project", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      const thread = createThread();
      const comment = createComment();
      commentRepository.findThreadById.mockResolvedValue(thread);
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("editor"),
      );
      commentRepository.addComment.mockResolvedValue(comment);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      const result = await service.replyToThread({
        projectId: "project-1",
        threadId: "thread-1",
        actorUserId: "user-1",
        body: "reply body",
      });

      expect(result).toBe(comment);
      expect(commentRepository.findThreadById).toHaveBeenCalledWith("thread-1");
      expect(projectAccessService.requireProjectRole).toHaveBeenCalledWith(
        "project-1",
        "user-1",
        ["admin", "editor", "commenter"],
      );
      expect(commentRepository.addComment).toHaveBeenCalledWith({
        threadId: "thread-1",
        authorId: "user-1",
        body: "reply body",
      });
      expect(
        commentRepository.findThreadById.mock.invocationCallOrder[0],
      ).toBeLessThan(
        projectAccessService.requireProjectRole.mock.invocationCallOrder[0] ??
          0,
      );
    });

    it("rejects when thread does not exist", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(null);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.replyToThread({
          projectId: "project-1",
          threadId: "missing-thread",
          actorUserId: "user-1",
          body: "reply",
        }),
      ).rejects.toBeInstanceOf(CommentThreadNotFoundError);
      expect(projectAccessService.requireProjectRole).not.toHaveBeenCalled();
      expect(commentRepository.addComment).not.toHaveBeenCalled();
    });

    it("rejects when thread belongs to a different project", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(createThread());
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.replyToThread({
          projectId: "other-project",
          threadId: "thread-1",
          actorUserId: "user-1",
          body: "reply",
        }),
      ).rejects.toBeInstanceOf(CommentThreadNotFoundError);
      expect(projectAccessService.requireProjectRole).not.toHaveBeenCalled();
      expect(commentRepository.addComment).not.toHaveBeenCalled();
    });

    it("rejects for reader role", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(createThread());
      projectAccessService.requireProjectRole.mockRejectedValue(
        new ProjectRoleRequiredError(["admin", "editor", "commenter"]),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.replyToThread({
          projectId: "project-1",
          threadId: "thread-1",
          actorUserId: "user-1",
          body: "reply",
        }),
      ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
      expect(commentRepository.addComment).not.toHaveBeenCalled();
    });

    it("passes through CommentAuthorNotFoundError from repository", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(createThread());
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("commenter"),
      );
      commentRepository.addComment.mockRejectedValue(
        new CommentAuthorNotFoundError(),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.replyToThread({
          projectId: "project-1",
          threadId: "thread-1",
          actorUserId: "deleted-user",
          body: "reply",
        }),
      ).rejects.toBeInstanceOf(CommentAuthorNotFoundError);
    });
  });

  describe("updateThreadStatus", () => {
    it("updates status after verifying commenter role", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      const thread = createThread();
      const updatedThread = createThreadWithComments({ status: "resolved" });
      commentRepository.findThreadById.mockResolvedValue(thread);
      projectAccessService.requireProjectRole.mockResolvedValue(
        createProjectWithRole("commenter"),
      );
      commentRepository.updateThreadStatus.mockResolvedValue(updatedThread);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      const result = await service.updateThreadStatus({
        projectId: "project-1",
        threadId: "thread-1",
        actorUserId: "user-1",
        status: "resolved",
      });

      expect(result).toBe(updatedThread);
      expect(commentRepository.findThreadById).toHaveBeenCalledWith("thread-1");
      expect(projectAccessService.requireProjectRole).toHaveBeenCalledWith(
        "project-1",
        "user-1",
        ["admin", "editor", "commenter"],
      );
      expect(commentRepository.updateThreadStatus).toHaveBeenCalledWith({
        threadId: "thread-1",
        status: "resolved",
      });
    });

    it("rejects when thread does not exist", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(null);
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.updateThreadStatus({
          projectId: "project-1",
          threadId: "missing-thread",
          actorUserId: "user-1",
          status: "resolved",
        }),
      ).rejects.toBeInstanceOf(CommentThreadNotFoundError);
      expect(projectAccessService.requireProjectRole).not.toHaveBeenCalled();
      expect(commentRepository.updateThreadStatus).not.toHaveBeenCalled();
    });

    it("rejects when thread belongs to a different project", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(createThread());
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.updateThreadStatus({
          projectId: "other-project",
          threadId: "thread-1",
          actorUserId: "user-1",
          status: "resolved",
        }),
      ).rejects.toBeInstanceOf(CommentThreadNotFoundError);
      expect(projectAccessService.requireProjectRole).not.toHaveBeenCalled();
      expect(commentRepository.updateThreadStatus).not.toHaveBeenCalled();
    });

    it("rejects for reader role", async () => {
      const { commentRepository, projectAccessService } = createDependencies();
      commentRepository.findThreadById.mockResolvedValue(createThread());
      projectAccessService.requireProjectRole.mockRejectedValue(
        new ProjectRoleRequiredError(["admin", "editor", "commenter"]),
      );
      const service = createCommentService({
        commentRepository,
        projectAccessService,
      });

      await expect(
        service.updateThreadStatus({
          projectId: "project-1",
          threadId: "thread-1",
          actorUserId: "user-1",
          status: "resolved",
        }),
      ).rejects.toBeInstanceOf(ProjectRoleRequiredError);
      expect(commentRepository.updateThreadStatus).not.toHaveBeenCalled();
    });
  });
});

function createDependencies() {
  return {
    commentRepository: {
      createThread: vi.fn<CommentRepository["createThread"]>(),
      listThreadsForProject:
        vi.fn<CommentRepository["listThreadsForProject"]>(),
      listThreadsForDocument:
        vi.fn<CommentRepository["listThreadsForDocument"]>(),
      addComment: vi.fn<CommentRepository["addComment"]>(),
      findThreadById: vi.fn<CommentRepository["findThreadById"]>(),
      updateThreadStatus: vi.fn<CommentRepository["updateThreadStatus"]>(),
    },
    projectAccessService: {
      requireProjectMember:
        vi.fn<ProjectAccessService["requireProjectMember"]>(),
      requireProjectRole: vi.fn<ProjectAccessService["requireProjectRole"]>(),
    },
  };
}

function createProjectWithRole(
  role: ProjectWithRole["myRole"],
): ProjectWithRole {
  return {
    project: {
      id: "project-1",
      name: "Project One",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
      tombstoneAt: null,
    },
    myRole: role,
  };
}

function createThread(
  overrides: Partial<StoredCommentThread> = {},
): StoredCommentThread {
  return {
    id: "thread-1",
    projectId: "project-1",
    documentId: "document-1",
    status: "open",
    startAnchor: "anchor-start",
    endAnchor: "anchor-end",
    quotedText: "quoted text",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createComment(overrides: Partial<StoredComment> = {}): StoredComment {
  return {
    id: "comment-1",
    threadId: "thread-1",
    authorId: "user-1",
    authorName: "Test User",
    body: "comment body",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createThreadWithComments(
  overrides: Partial<StoredCommentThreadWithComments> = {},
): StoredCommentThreadWithComments {
  return {
    ...createThread(),
    comments: [createComment()],
    ...overrides,
  };
}
