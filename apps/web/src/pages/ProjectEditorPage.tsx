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
  CommentThread,
  CommentThreadListResponse,
  CommentThreadCreatedEvent,
  CommentAddedEvent,
  CommentThreadStatusChangedEvent,
  FileTreeChangedEvent,
  SnapshotRestoredEvent,
} from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/useApiQuery";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/contexts/useAuth";
import { Button } from "@/components/ui/button";
import FileTree, { type FileTreeAction } from "@/components/FileTree";
import FileTreeActions from "@/components/FileTreeActions";
import Editor from "@/components/Editor";
import BinaryPreview from "@/components/BinaryPreview";
import PdfPreview from "@/components/PdfPreview";
import CommentPanel from "@/components/CommentPanel";
import type { CommentSelection } from "@/components/CreateCommentForm";
import MembersPanel from "@/components/MembersPanel";
import SnapshotPanel from "@/components/SnapshotPanel";

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
const MIN_COMMENT_HEIGHT = 100;
const MAX_COMMENT_HEIGHT = 600;
const DEFAULT_COMMENT_HEIGHT = 250;

function ResizeHandle({
  onCommit,
  targetRef,
  min,
  max,
  invert,
}: {
  onCommit: (totalDelta: number) => void;
  targetRef: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  invert?: boolean;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onCommitRef = useRef(onCommit);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onCommitRef.current = onCommit;
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
    const startWidth = targetRef.current?.offsetWidth ?? 0;
    let accumulated = 0;

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      accumulated += delta;

      if (targetRef.current) {
        const effectiveDelta = invert ? -accumulated : accumulated;
        const newWidth = Math.max(
          min,
          Math.min(startWidth + effectiveDelta, max),
        );
        targetRef.current.style.width = `${newWidth}px`;
      }
    }

    function onMouseUp() {
      dragging.current = false;
      cleanupRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommitRef.current(accumulated);
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

function ResizeHandleVertical({
  onCommit,
  targetRef,
}: {
  onCommit: (totalDelta: number) => void;
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dragging = useRef(false);
  const lastY = useRef(0);
  const onCommitRef = useRef(onCommit);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    lastY.current = e.clientY;
    const startHeight = targetRef.current?.offsetHeight ?? 0;
    let accumulated = 0;

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientY - lastY.current;
      lastY.current = ev.clientY;
      accumulated += delta;

      // Direct DOM manipulation — no React re-render during drag
      if (targetRef.current) {
        const newHeight = Math.max(
          MIN_COMMENT_HEIGHT,
          Math.min(startHeight - accumulated, MAX_COMMENT_HEIGHT),
        );
        targetRef.current.style.height = `${newHeight}px`;
      }
    }

    function onMouseUp() {
      dragging.current = false;
      cleanupRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Commit final delta to React state
      onCommitRef.current(accumulated);
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
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div
      className="flex h-1.5 shrink-0 cursor-row-resize items-center justify-center hover:bg-accent/50 active:bg-accent"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="horizontal"
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
  type ProjectLoadResult = {
    project: Project;
    myRole: ProjectRole;
    nodes: FileTreeNode[];
    mainDocumentId: string | null;
  };

  const {
    data: projectData,
    isLoading,
    error,
    refetch: retryLoad,
    setData: setProjectData,
  } = useApiQuery<ProjectLoadResult | null>({
    queryFn: async (signal) => {
      const opts = { signal };
      try {
        const [details, tree, main] = await Promise.all([
          api.get<ProjectDetailsResponse>(`/projects/${projectId}`, opts),
          api.get<ProjectFileTreeResponse>(`/projects/${projectId}/tree`, opts),
          api.get<MainDocumentResponse>(
            `/projects/${projectId}/main-document`,
            opts,
          ),
        ]);
        return {
          project: details.project,
          myRole: details.myRole,
          nodes: tree.nodes,
          mainDocumentId: main.mainDocument?.id ?? null,
        };
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 404) throw new ApiError(404, "Project not found");
          if (err.status === 403)
            throw new ApiError(403, "You don't have access to this project");
        }
        throw err;
      }
    },
    deps: [projectId],
    initialData: null,
    enabled: !!projectId,
  });

  const project = projectData?.project ?? null;
  const myRole = projectData?.myRole ?? null;
  const nodes = projectData?.nodes ?? [];
  const mainDocumentId = projectData?.mainDocumentId ?? null;

  const setNodes = useCallback(
    (updater: FileTreeNode[] | ((prev: FileTreeNode[]) => FileTreeNode[])) => {
      setProjectData((prev) =>
        prev
          ? {
              ...prev,
              nodes:
                typeof updater === "function" ? updater(prev.nodes) : updater,
            }
          : prev,
      );
    },
    [setProjectData],
  );

  const setMainDocumentId = useCallback(
    (id: string | null) => {
      setProjectData((prev) => (prev ? { ...prev, mainDocumentId: id } : prev));
    },
    [setProjectData],
  );

  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
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
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [syncGeneration, setSyncGeneration] = useState(0);
  const [pendingCommentSelection, setPendingCommentSelection] =
    useState<CommentSelection | null>(null);

  // Right panel vertical split state
  const [previewSectionCollapsed, setPreviewSectionCollapsed] = useState(false);
  const [commentPanelCollapsed, setCommentPanelCollapsed] = useState(false);
  const [commentPanelHeight, setCommentPanelHeight] = useState(
    DEFAULT_COMMENT_HEIGHT,
  );
  const [threadPositions, setThreadPositions] = useState<Map<string, number>>(
    () => new Map(),
  );

  const selectedDocId = selectedFile?.documentId;
  const selectedDocKind = selectedFile?.documentKind;

  const {
    data: threads,
    isLoading: threadsLoading,
    error: threadsError,
    refetch: fetchThreads,
    setData: setThreads,
  } = useApiQuery<CommentThread[]>({
    queryFn: (signal) =>
      api
        .get<CommentThreadListResponse>(
          `/projects/${projectId}/docs/${selectedDocId}/comments`,
          { signal },
        )
        .then((d) => d.threads),
    deps: [projectId, selectedDocId],
    initialData: [],
    enabled: !!projectId && !!selectedDocId && selectedDocKind === "text",
  });

  // Reset thread positions when selected file changes
  useEffect(() => {
    setThreadPositions(new Map());
  }, [selectedDocId]);

  // Socket listeners for realtime comment updates
  useEffect(() => {
    if (!projectId || !selectedDocId) return;
    const socket = getSocket();

    function handleThreadCreated(data: CommentThreadCreatedEvent) {
      if (data.projectId !== projectId || data.documentId !== selectedDocId)
        return;
      setThreads((prev) => {
        if (prev.some((t) => t.id === data.thread.id)) return prev;
        return [...prev, data.thread];
      });
    }

    function handleCommentAdded(data: CommentAddedEvent) {
      if (data.projectId !== projectId || data.documentId !== selectedDocId)
        return;
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== data.threadId) return t;
          if (t.comments.some((c) => c.id === data.comment.id)) return t;
          return { ...t, comments: [...t.comments, data.comment] };
        }),
      );
    }

    function handleStatusChanged(data: CommentThreadStatusChangedEvent) {
      if (data.projectId !== projectId || data.documentId !== selectedDocId)
        return;
      setThreads((prev) =>
        prev.map((t) =>
          t.id === data.threadId ? { ...t, status: data.status } : t,
        ),
      );
    }

    socket.on("comment:thread_created", handleThreadCreated);
    socket.on("comment:added", handleCommentAdded);
    socket.on("comment:thread_status_changed", handleStatusChanged);

    return () => {
      socket.off("comment:thread_created", handleThreadCreated);
      socket.off("comment:added", handleCommentAdded);
      socket.off("comment:thread_status_changed", handleStatusChanged);
    };
  }, [projectId, selectedDocId, setThreads]);

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
  }, [projectId, setNodes]);

  // Listen for file tree changes from other users (create, delete, move, rename)
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    function handleTreeChanged(data: FileTreeChangedEvent) {
      if (data.projectId !== projectId) return;
      refreshTree().catch((err) => console.error("Tree refresh failed:", err));
    }

    socket.on("project:tree_changed", handleTreeChanged);
    return () => {
      socket.off("project:tree_changed", handleTreeChanged);
    };
  }, [projectId, refreshTree]);

  // Listen for snapshot restore — refetch tree, comments, and re-sync editor
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    function handleSnapshotRestored(data: SnapshotRestoredEvent) {
      if (data.projectId !== projectId) return;
      refreshTree().catch((err) => console.error("Tree refresh failed:", err));
      if (selectedDocId && selectedDocKind === "text") {
        fetchThreads();
      }
      setSyncGeneration((g) => g + 1);
    }

    socket.on("snapshot:restored", handleSnapshotRestored);
    return () => {
      socket.off("snapshot:restored", handleSnapshotRestored);
    };
  }, [projectId, refreshTree, fetchThreads, selectedDocId, selectedDocKind]);

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

  const handleCommentSelection = useCallback((selection: CommentSelection) => {
    setPendingCommentSelection(selection);
    setCommentPanelCollapsed(false);
    setPreviewCollapsed(false);
  }, []);

  const fileTreeRef = useRef<HTMLElement>(null);
  const previewPanelRef = useRef<HTMLElement>(null);

  const handleFileTreeResizeCommit = useCallback((totalDelta: number) => {
    setFileTreeWidth((w) =>
      Math.max(MIN_PANEL_WIDTH, Math.min(w + totalDelta, 600)),
    );
  }, []);

  const handlePreviewWidthResizeCommit = useCallback((totalDelta: number) => {
    setPreviewWidth((w) =>
      Math.max(MIN_PANEL_WIDTH, Math.min(w - totalDelta, 600)),
    );
  }, []);

  const commentSectionRef = useRef<HTMLDivElement>(null);

  const handleCommentResizeCommit = useCallback((totalDelta: number) => {
    setCommentPanelHeight((h) =>
      Math.max(
        MIN_COMMENT_HEIGHT,
        Math.min(h - totalDelta, MAX_COMMENT_HEIGHT),
      ),
    );
  }, []);

  function handleAction(action: FileTreeAction) {
    setPendingAction(action);
  }

  function handleComplete(created?: SelectedFile) {
    if (pendingAction) {
      if (pendingAction.type === "delete") {
        localFolderPathsRef.current.delete(pendingAction.path);
        const lastSlash = pendingAction.path.lastIndexOf("/");
        const parent =
          lastSlash <= 0 ? "/" : pendingAction.path.slice(0, lastSlash);
        if (parent !== "/") localFolderPathsRef.current.add(parent);
      } else if (pendingAction.type === "delete-multiple") {
        for (const item of pendingAction.items) {
          localFolderPathsRef.current.delete(item.path);
          const lastSlash = item.path.lastIndexOf("/");
          const parent = lastSlash <= 0 ? "/" : item.path.slice(0, lastSlash);
          if (parent !== "/") localFolderPathsRef.current.add(parent);
        }
      }

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
          <Button variant="outline" onClick={retryLoad}>
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
          <Button variant="outline" onClick={retryLoad}>
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
          Projects
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="truncate text-sm font-semibold">{project.name}</h1>
        <span className="mx-auto text-sm font-semibold text-muted-foreground">
          CollabTex
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSnapshots((v) => !v)}
            aria-pressed={showSnapshots}
          >
            Snapshots
          </Button>
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
              ref={fileTreeRef}
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
                onSelectFile={(file) => {
                  setSelectedFile(file);
                  setPendingCommentSelection(null);
                }}
                onAction={handleAction}
              />
            </aside>
            <ResizeHandle
              onCommit={handleFileTreeResizeCommit}
              targetRef={fileTreeRef}
              min={MIN_PANEL_WIDTH}
              max={600}
            />
          </>
        )}

        {/* Editor panel */}
        <main className="flex flex-1 overflow-hidden rounded-lg border bg-background">
          {selectedFile ? (
            selectedFile.documentKind === "text" ? (
              <Editor
                key={`${selectedFile.documentId}-${syncGeneration}`}
                projectId={projectId!}
                documentId={selectedFile.documentId}
                path={selectedFile.path}
                role={myRole}
                userName={userName}
                onCommentSelection={handleCommentSelection}
                commentThreads={threads}
                onThreadPositionsChange={setThreadPositions}
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

        {/* Right panel: Preview (top) + Comments (bottom) */}
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
              onCommit={handlePreviewWidthResizeCommit}
              targetRef={previewPanelRef}
              min={MIN_PANEL_WIDTH}
              max={600}
              invert
            />
            <aside
              ref={previewPanelRef}
              className="flex shrink-0 flex-col overflow-hidden rounded-lg border bg-background"
              style={{ width: previewWidth }}
            >
              {/* Preview section (top) */}
              <div
                className={`flex flex-col overflow-hidden ${previewSectionCollapsed ? "shrink-0" : "min-h-0 flex-1"}`}
              >
                <div className="flex items-center justify-between border-b px-2 py-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Preview
                    </span>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setPreviewSectionCollapsed((v) => !v)}
                      aria-label={
                        previewSectionCollapsed
                          ? "Expand preview section"
                          : "Collapse preview section"
                      }
                    >
                      {previewSectionCollapsed ? "▶" : "▼"}
                    </button>
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setPreviewCollapsed(true)}
                    aria-label="Collapse preview"
                  >
                    ▶
                  </button>
                </div>
                {!previewSectionCollapsed && (
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <PdfPreview
                      projectId={projectId!}
                      projectName={project?.name ?? ""}
                      role={myRole!}
                    />
                  </div>
                )}
              </div>

              {/* Vertical resize handle — only when both sections expanded */}
              {!commentPanelCollapsed && !previewSectionCollapsed && (
                <ResizeHandleVertical
                  onCommit={handleCommentResizeCommit}
                  targetRef={commentSectionRef}
                />
              )}

              {/* Comments section (bottom) */}
              <div
                ref={commentSectionRef}
                className={`flex flex-col overflow-hidden ${commentPanelCollapsed ? "shrink-0" : previewSectionCollapsed ? "min-h-0 flex-1" : "shrink-0"}`}
                style={
                  commentPanelCollapsed || previewSectionCollapsed
                    ? undefined
                    : { height: commentPanelHeight }
                }
                data-testid="comment-section"
              >
                <div className="flex items-center justify-between border-t px-2 py-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Comments
                  </span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setCommentPanelCollapsed((v) => !v)}
                    aria-label={
                      commentPanelCollapsed
                        ? "Expand comments"
                        : "Collapse comments"
                    }
                  >
                    {commentPanelCollapsed ? "▲" : "▼"}
                  </button>
                </div>
                {!commentPanelCollapsed &&
                  (selectedFile?.documentKind === "text" ? (
                    <CommentPanel
                      key={selectedFile.documentId}
                      projectId={projectId!}
                      documentId={selectedFile.documentId}
                      role={myRole!}
                      threads={threads}
                      isLoading={threadsLoading}
                      error={threadsError}
                      onRetry={fetchThreads}
                      onMutated={fetchThreads}
                      pendingSelection={pendingCommentSelection}
                      onClearSelection={() => setPendingCommentSelection(null)}
                      threadPositions={threadPositions}
                    />
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-4">
                      <p className="text-sm text-muted-foreground">
                        Select a text file to view comments
                      </p>
                    </div>
                  ))}
              </div>
            </aside>
          </>
        )}
      </div>

      <FileTreeActions
        projectId={projectId}
        action={pendingAction}
        localFolderPaths={localFolderPathsRef.current} // eslint-disable-line react-hooks/refs -- intentional: stable Set shared with tree actions
        onClose={() => setPendingAction(null)}
        onComplete={handleComplete}
        onMainDocumentChange={(docId) => {
          setMainDocumentId(docId);
          setPendingAction(null);
        }}
        onCreateFolder={handleCreateFolder}
      />

      {showSnapshots && projectId && myRole && (
        <SnapshotPanel
          projectId={projectId}
          myRole={myRole}
          onClose={() => setShowSnapshots(false)}
        />
      )}

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
