import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import type {
  Project,
  ProjectRole,
  FileTreeNode,
  FileTreeFolderNode,
  ProjectDetailsResponse,
  ProjectFileTreeResponse,
  MainDocumentResponse,
} from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Button } from "@/components/ui/button";
import FileTree, { type FileTreeAction } from "@/components/FileTree";
import FileTreeActions from "@/components/FileTreeActions";
import Editor from "@/components/Editor";
import BinaryPreview from "@/components/BinaryPreview";
import PdfPreview from "@/components/PdfPreview";
import MembersPanel from "@/components/MembersPanel";

type SelectedFile = {
  documentId: string;
  path: string;
  documentKind: "text" | "binary";
  mime: string | null;
};

function removeNodeFromTree(
  nodes: FileTreeNode[],
  path: string,
): FileTreeNode[] {
  return nodes
    .filter((n) => n.path !== path)
    .map((n) =>
      n.type === "folder"
        ? { ...n, children: removeNodeFromTree(n.children, path) }
        : n,
    );
}

function pathExistsInTree(nodes: FileTreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.path === path) return true;
    if (node.type === "folder" && pathExistsInTree(node.children, path)) {
      return true;
    }
  }
  return false;
}

function mergeLocalFolders(
  apiNodes: FileTreeNode[],
  localPaths: Set<string>,
): FileTreeNode[] {
  if (localPaths.size === 0) return apiNodes;

  let result = apiNodes;
  for (const folderPath of localPaths) {
    if (pathExistsInTree(result, folderPath)) continue;

    const lastSlash = folderPath.lastIndexOf("/");
    const parentPath = lastSlash <= 0 ? "/" : folderPath.slice(0, lastSlash);
    const name = folderPath.slice(lastSlash + 1);
    const folder: FileTreeFolderNode = {
      type: "folder",
      name,
      path: folderPath,
      children: [],
    };

    if (parentPath === "/") {
      result = [...result, folder];
    } else {
      result = insertFolderIntoTree(result, parentPath, folder);
    }
  }
  return result;
}

function insertFolderIntoTree(
  nodes: FileTreeNode[],
  parentPath: string,
  folder: FileTreeFolderNode,
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.type === "folder" && node.path === parentPath) {
      return { ...node, children: [...node.children, folder] };
    }
    if (node.type === "folder") {
      return {
        ...node,
        children: insertFolderIntoTree(node.children, parentPath, folder),
      };
    }
    return node;
  });
}

const MIN_PANEL_WIDTH = 150;

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onDragRef = useRef(onDrag);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onDragRef.current = onDrag;
  });

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onDragRef.current(delta);
    }

    function onMouseUp() {
      dragging.current = false;
      cleanupRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    cleanupRef.current = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div
      className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}

export default function ProjectEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { state, logout } = useAuth();
  const navigate = useNavigate();
  const userName =
    state.status === "authenticated" ? state.user.name : undefined;
  const currentUserId = state.status === "authenticated" ? state.user.id : "";
  const [project, setProject] = useState<Project | null>(null);
  const [myRole, setMyRole] = useState<ProjectRole | null>(null);
  const [nodes, setNodes] = useState<FileTreeNode[]>([]);
  const [mainDocumentId, setMainDocumentId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [treeError, setTreeError] = useState("");
  const [pendingAction, setPendingAction] = useState<FileTreeAction | null>(
    null,
  );
  const localFolderPathsRef = useRef<Set<string>>(new Set());
  const refreshControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      refreshControllerRef.current?.abort();
    };
  }, []);

  const [fileTreeWidth, setFileTreeWidth] = useState(256);
  const [previewWidth, setPreviewWidth] = useState(320);
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const opts = { signal: controller.signal };

    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const [details, tree, main] = await Promise.all([
          api.get<ProjectDetailsResponse>(`/projects/${projectId}`, opts),
          api.get<ProjectFileTreeResponse>(`/projects/${projectId}/tree`, opts),
          api.get<MainDocumentResponse>(
            `/projects/${projectId}/main-document`,
            opts,
          ),
        ]);
        if (controller.signal.aborted) return;
        setProject(details.project);
        setMyRole(details.myRole);
        setNodes(tree.nodes);
        setMainDocumentId(main.mainDocument?.id ?? null);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setError("Project not found");
          } else if (err.status === 403) {
            setError("You don't have access to this project");
          } else {
            setError(err.message);
          }
        } else {
          console.error("Failed to load project:", err);
          setError("Failed to load project");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => controller.abort();
  }, [projectId, retryKey]);

  const refreshTree = useCallback(async () => {
    if (!projectId) return;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setTreeError("");
    try {
      const tree = await api.get<ProjectFileTreeResponse>(
        `/projects/${projectId}/tree`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setNodes(mergeLocalFolders(tree.nodes, localFolderPathsRef.current));
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof ApiError ? err.message : "Failed to refresh file tree";
      console.error("Failed to refresh tree:", err);
      setTreeError(message);
    }
  }, [projectId]);

  function handleCreateFolder(parentPath: string, name: string) {
    const folderPath =
      parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
    const newFolder: FileTreeFolderNode = {
      type: "folder",
      name,
      path: folderPath,
      children: [],
    };
    localFolderPathsRef.current.add(folderPath);
    if (parentPath === "/") {
      setNodes((prev) => [...prev, newFolder]);
    } else {
      setNodes((prev) => insertFolderIntoTree(prev, parentPath, newFolder));
    }
  }

  function handleAction(action: FileTreeAction) {
    setPendingAction(action);
  }

  function handleComplete(created?: SelectedFile) {
    if (pendingAction) {
      // Clean up local folders on delete
      if (pendingAction.type === "delete") {
        localFolderPathsRef.current.delete(pendingAction.path);
      } else if (pendingAction.type === "delete-multiple") {
        for (const item of pendingAction.items) {
          localFolderPathsRef.current.delete(item.path);
        }
      }

      // After move, preserve source parent folders as local empty folders
      if (pendingAction.type === "move") {
        const lastSlash = pendingAction.path.lastIndexOf("/");
        const parent =
          lastSlash <= 0 ? "/" : pendingAction.path.slice(0, lastSlash);
        if (parent !== "/") localFolderPathsRef.current.add(parent);
      } else if (pendingAction.type === "move-multiple") {
        for (const item of pendingAction.items) {
          const lastSlash = item.path.lastIndexOf("/");
          const parent = lastSlash <= 0 ? "/" : item.path.slice(0, lastSlash);
          if (parent !== "/") localFolderPathsRef.current.add(parent);
        }
      }

      // Remove local-only folders from nodes
      if (pendingAction.type === "delete") {
        setNodes((prev) => removeNodeFromTree(prev, pendingAction.path));
      } else if (pendingAction.type === "delete-multiple") {
        setNodes((prev) => {
          let result = prev;
          for (const item of pendingAction.items) {
            result = removeNodeFromTree(result, item.path);
          }
          return result;
        });
      }

      if (selectedFile) {
        const shouldClear =
          (pendingAction.type === "delete" ||
            pendingAction.type === "rename") &&
          (selectedFile.path === pendingAction.path ||
            selectedFile.path.startsWith(pendingAction.path + "/"));
        const shouldClearMulti =
          pendingAction.type === "delete-multiple" &&
          pendingAction.items.some(
            (item) =>
              selectedFile.path === item.path ||
              selectedFile.path.startsWith(item.path + "/"),
          );
        if (shouldClear || shouldClearMulti) {
          setSelectedFile(null);
        }
      }
    }

    // Auto-select newly created file
    if (created) {
      setSelectedFile(created);
    }

    setPendingAction(null);
    refreshTree();
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading project…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive" role="alert">
          {error}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </Button>
          <Link to="/">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!project || !myRole || !projectId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive">
          Something went wrong. Please try again.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </Button>
          <Link to="/">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Link
          to="/"
          className="text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          CollabTex
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="truncate text-sm font-semibold">{project.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMembers((v) => !v)}
            aria-pressed={showMembers}
          >
            Members
          </Button>
          {userName && (
            <span className="text-sm text-muted-foreground">{userName}</span>
          )}
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 gap-1.5 overflow-hidden bg-muted/30 p-1.5">
        {/* File tree panel */}
        {fileTreeCollapsed ? (
          <div className="flex shrink-0 items-start rounded-lg border bg-background">
            <button
              className="px-1 py-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setFileTreeCollapsed(false)}
              aria-label="Expand file tree"
            >
              ▶
            </button>
          </div>
        ) : (
          <>
            <aside
              className="shrink-0 overflow-hidden rounded-lg border bg-background"
              style={{ width: fileTreeWidth }}
            >
              <div className="flex items-center justify-between border-b px-2 py-1">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setFileTreeCollapsed(true)}
                  aria-label="Collapse file tree"
                >
                  ◀
                </button>
                <span className="text-xs font-medium text-muted-foreground">
                  Files
                </span>
              </div>
              {treeError && (
                <div className="border-b px-2 py-1 text-xs text-destructive">
                  {treeError}{" "}
                  <button className="underline" onClick={refreshTree}>
                    Retry
                  </button>
                </div>
              )}
              <FileTree
                nodes={nodes}
                selectedPath={selectedFile?.path ?? null}
                mainDocumentId={mainDocumentId}
                myRole={myRole}
                onSelectFile={setSelectedFile}
                onAction={handleAction}
              />
            </aside>
            <ResizeHandle
              onDrag={(delta) =>
                setFileTreeWidth((w) =>
                  Math.max(MIN_PANEL_WIDTH, Math.min(w + delta, 600)),
                )
              }
            />
          </>
        )}

        {/* Editor panel */}
        <main className="flex flex-1 overflow-hidden rounded-lg border bg-background">
          {selectedFile ? (
            selectedFile.documentKind === "text" ? (
              <Editor
                key={selectedFile.documentId}
                projectId={projectId!}
                documentId={selectedFile.documentId}
                path={selectedFile.path}
                role={myRole}
                userName={userName}
              />
            ) : (
              <BinaryPreview
                key={selectedFile.documentId}
                projectId={projectId!}
                documentId={selectedFile.documentId}
                path={selectedFile.path}
                mime={selectedFile.mime}
              />
            )
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Select a file to edit
              </p>
            </div>
          )}
        </main>

        {/* Preview panel */}
        {previewCollapsed ? (
          <div className="flex shrink-0 items-start rounded-lg border bg-background">
            <button
              className="px-1 py-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setPreviewCollapsed(false)}
              aria-label="Expand preview"
            >
              ◀
            </button>
          </div>
        ) : (
          <>
            <ResizeHandle
              onDrag={(delta) =>
                setPreviewWidth((w) =>
                  Math.max(MIN_PANEL_WIDTH, Math.min(w - delta, 600)),
                )
              }
            />
            <aside
              className="shrink-0 overflow-hidden rounded-lg border bg-background"
              style={{ width: previewWidth }}
            >
              <div className="flex items-center justify-between border-b px-2 py-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Preview
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setPreviewCollapsed(true)}
                  aria-label="Collapse preview"
                >
                  ▶
                </button>
              </div>
              <PdfPreview projectId={projectId!} role={myRole!} />
            </aside>
          </>
        )}
      </div>

      <FileTreeActions
        projectId={projectId}
        action={pendingAction}
        localFolderPaths={localFolderPathsRef.current}
        onClose={() => setPendingAction(null)}
        onComplete={handleComplete}
        onMainDocumentChange={(docId) => {
          setMainDocumentId(docId);
          setPendingAction(null);
        }}
        onCreateFolder={handleCreateFolder}
      />

      {showMembers && projectId && myRole && currentUserId && (
        <MembersPanel
          projectId={projectId}
          myRole={myRole}
          currentUserId={currentUserId}
          onClose={() => setShowMembers(false)}
          onProjectDeleted={() => navigate("/")}
        />
      )}
    </div>
  );
}
