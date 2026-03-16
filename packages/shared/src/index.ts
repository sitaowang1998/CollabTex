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
};

export type WorkspaceOpenedEvent = {
  projectId: string;
  document: ProjectDocument;
  content: string | null;
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

export type ServerToClientEvents = {
  "workspace:opened": (data: WorkspaceOpenedEvent) => void;
  "realtime:error": (data: WorkspaceErrorEvent) => void;
  "doc.sync.response": (data: DocumentSyncResponseEvent) => void;
  "doc.update": (data: ServerDocumentUpdateEvent) => void;
  "doc.update.ack": (data: DocumentUpdateAckEvent) => void;
  "doc.reset": (data: DocumentResetEvent) => void;
};

export type ClientToServerEvents = {
  "workspace:join": (data: WorkspaceJoinRequest) => void;
  "doc.sync.request": (data: DocumentSyncRequest) => void;
  "doc.update": (data: ClientDocumentUpdateEvent) => void;
};
