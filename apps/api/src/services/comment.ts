export type StoredCommentThread = {
  id: string;
  projectId: string;
  documentId: string;
  status: "open" | "resolved";
  startAnchor: string;
  endAnchor: string;
  quotedText: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredComment = {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  createdAt: Date;
};

export type StoredCommentThreadWithComments = StoredCommentThread & {
  comments: StoredComment[];
};

export type CommentRepository = {
  createThread: (input: {
    projectId: string;
    documentId: string;
    startAnchor: string;
    endAnchor: string;
    quotedText: string;
    authorId: string;
    body: string;
  }) => Promise<StoredCommentThreadWithComments>;
  listThreadsForDocument: (input: {
    projectId: string;
    documentId: string;
  }) => Promise<StoredCommentThreadWithComments[]>;
  addComment: (input: {
    threadId: string;
    authorId: string;
    body: string;
  }) => Promise<StoredComment>;
  findThreadById: (threadId: string) => Promise<StoredCommentThread | null>;
};

export class CommentThreadNotFoundError extends Error {
  constructor() {
    super("Comment thread not found");
  }
}

export class CommentDocumentNotFoundError extends Error {
  constructor() {
    super("Document not found for comment");
  }
}
