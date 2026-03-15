import type {
  FileTreeNode,
  ProjectMember,
  ProjectRole,
  ProjectSummary,
} from "../../../../packages/shared/src/index";

export const TOKEN_STORAGE_KEY = "collabtex-token";

export type AppScreen =
  | { name: "auth" }
  | { name: "projects" }
  | { name: "workspace"; projectId: string };

export type AuthMode = "login" | "register";

export type AuthFormState = {
  email: string;
  password: string;
  name: string;
};

export type CreateProjectState = {
  name: string;
};

export type CreateFileState = {
  open: boolean;
  path: string;
  kind: "text" | "binary";
  mime: string;
};

export type WorkspaceState = {
  project: ProjectSummary | null;
  role: ProjectRole | null;
  members: ProjectMember[];
  tree: FileTreeNode[];
  selectedPath: string | null;
  selectedContent: string;
  selectedKind: "text" | "binary" | null;
};
