export type JwtPayload = {
  sub: string; // user id
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type RegisterRequest = {
  email: string;
  name: string;
  password: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type CreateProjectRequest = {
  name: string;
};

export type UpdateProjectRequest = {
  name: string;
};

export type ProjectRole = "admin" | "editor" | "commenter" | "reader";

export type DocumentKind = "text" | "binary";

export type ProjectDocument = {
  id: string;
  path: string;
  kind: DocumentKind;
  mime: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FileTreeFileNode = {
  type: "file";
  name: string;
  path: string;
  documentId: string;
  documentKind: DocumentKind;
  mime: string | null;
};

export type FileTreeFolderNode = {
  type: "folder";
  name: string;
  path: string;
  children: FileTreeNode[];
};

export type FileTreeNode = FileTreeFileNode | FileTreeFolderNode;

export type CreateFileRequest = {
  path: string;
  kind: DocumentKind;
  mime?: string;
};

export type MoveNodeRequest = {
  path: string;
  destinationParentPath: string | null;
};

export type RenameNodeRequest = {
  path: string;
  name: string;
};

export type DeleteNodeRequest = {
  path: string;
};

export type ProjectFileTreeResponse = {
  nodes: FileTreeNode[];
};

export type ProjectDocumentResponse = {
  document: ProjectDocument;
};

export type ProjectDocumentContentResponse = {
  document: ProjectDocument;
  content: string | null;
};

export type SetMainDocumentRequest = {
  documentId: string;
};

export type MainDocumentResponse = {
  mainDocument: ProjectDocument | null;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  myRole: ProjectRole;
  updatedAt: string;
};

export type ProjectSnapshot = {
  id: string;
  projectId: string;
  message: string | null;
  authorId: string | null;
  createdAt: string;
};

export type ProjectSnapshotListResponse = {
  snapshots: ProjectSnapshot[];
};

export type ProjectSnapshotRestoreResponse = {
  snapshot: ProjectSnapshot;
};

export type ProjectDetailsResponse = {
  project: Project;
  myRole: ProjectRole;
};

export type ProjectMember = {
  userId: string;
  email: string;
  name: string;
  role: ProjectRole;
};

export type AddProjectMemberRequest = {
  email: string;
  role: ProjectRole;
};

export type UpdateProjectMemberRequest = {
  role: ProjectRole;
};

export type ProjectMemberResponse = {
  member: ProjectMember;
};

export type ProjectMemberListResponse = {
  members: ProjectMember[];
};

export type WorkspaceJoinRequest = {
  projectId: string;
  documentId: string;
  awarenessClientID?: number;
};

export type WorkspaceOpenedEvent = {
  projectId: string;
  document: ProjectDocument;
  content: null;
};

export type DocumentSyncRequest = {
  documentId: string;
};

export type DocumentSyncResponseEvent = {
  documentId: string;
  stateB64: string;
  serverVersion: number;
};

export type ClientDocumentUpdateEvent = {
  documentId: string;
  updateB64: string;
  clientUpdateId: string;
};

export type ServerDocumentUpdateEvent = {
  documentId: string;
  updateB64: string;
  clientUpdateId: string;
  serverVersion: number;
};

export type DocumentUpdateAckEvent = {
  documentId: string;
  clientUpdateId: string;
  serverVersion: number;
};

export type DocumentResetEvent = {
  documentId: string;
  reason: string;
  serverVersion: number;
};

export type WorkspaceErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "UNAVAILABLE";

export type WorkspaceErrorEvent = {
  code: WorkspaceErrorCode;
  message: string;
};

export type CompileDoneEvent = {
  projectId: string;
  status: "success" | "failure";
  logs: string;
};

export type PresenceUpdateEvent = {
  documentId: string;
  awarenessB64: string;
};

export type CommentThreadCreatedEvent = {
  projectId: string;
  documentId: string;
  thread: CommentThread;
};

export type CommentAddedEvent = {
  projectId: string;
  documentId: string;
  threadId: string;
  comment: Comment;
};

export type CommentThreadStatusChangedEvent = {
  projectId: string;
  documentId: string;
  threadId: string;
  status: CommentThreadStatus;
};

export type FileTreeChangedEvent = {
  projectId: string;
};

export type ServerToClientEvents = {
  "workspace:opened": (data: WorkspaceOpenedEvent) => void;
  "realtime:error": (data: WorkspaceErrorEvent) => void;
  "doc.sync.response": (data: DocumentSyncResponseEvent) => void;
  "doc.update": (data: ServerDocumentUpdateEvent) => void;
  "doc.update.ack": (data: DocumentUpdateAckEvent) => void;
  "doc.reset": (data: DocumentResetEvent) => void;
  "compile:done": (data: CompileDoneEvent) => void;
  "presence.update": (data: PresenceUpdateEvent) => void;
  "comment:thread_created": (data: CommentThreadCreatedEvent) => void;
  "comment:added": (data: CommentAddedEvent) => void;
  "comment:thread_status_changed": (
    data: CommentThreadStatusChangedEvent,
  ) => void;
  "project:tree_changed": (data: FileTreeChangedEvent) => void;
};

export type ClientToServerEvents = {
  "workspace:join": (data: WorkspaceJoinRequest) => void;
  "doc.sync.request": (data: DocumentSyncRequest) => void;
  "doc.update": (data: ClientDocumentUpdateEvent) => void;
  "presence.update": (data: PresenceUpdateEvent) => void;
};

// Comment threads

export type CommentThreadStatus = "open" | "resolved";

export type Comment = {
  id: string;
  threadId: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type CommentThread = {
  id: string;
  documentId: string;
  projectId: string;
  status: CommentThreadStatus;
  startAnchor: string;
  endAnchor: string;
  quotedText: string;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
};

export type CommentThreadListResponse = { threads: CommentThread[] };
export type CommentThreadResponse = { thread: CommentThread };
export type CommentResponse = { comment: Comment };

export type CreateCommentThreadRequest = {
  startAnchorB64: string;
  endAnchorB64: string;
  quotedText: string;
  body: string;
};

export type UpdateCommentThreadRequest = { status: CommentThreadStatus };
export type ReplyToThreadRequest = { body: string };
