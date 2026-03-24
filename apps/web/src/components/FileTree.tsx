import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  FileTreeNode,
  FileTreeFileNode,
  ProjectRole,
} from "@collab-tex/shared";
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";

export type FileTreeAction =
  | { type: "create"; parentPath: string }
  | { type: "create-folder"; parentPath: string }
  | { type: "rename"; path: string; currentName: string }
  | { type: "move"; path: string; name: string; destination?: string }
  | {
      type: "move-multiple";
      items: { path: string; name: string }[];
      destination?: string;
    }
  | { type: "delete"; path: string; name: string }
  | { type: "delete-multiple"; items: { path: string; name: string }[] }
  | { type: "set-main"; documentId: string; path: string }
  | { type: "upload"; parentPath: string };

type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  mainDocumentId: string | null;
  myRole: ProjectRole;
  onSelectFile: (
    file: {
      documentId: string;
      path: string;
      documentKind: "text" | "binary";
      mime: string | null;
    } | null,
  ) => void;
  onAction: (action: FileTreeAction) => void;
};

type ContextMenuState = {
  node: FileTreeNode | null;
  x: number;
  y: number;
} | null;

const canMutate = (role: ProjectRole) => role === "admin" || role === "editor";

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function flattenVisiblePaths(
  nodes: FileTreeNode[],
  collapsed: Set<string>,
): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    result.push(node.path);
    if (node.type === "folder" && !collapsed.has(node.path)) {
      result.push(...flattenVisiblePaths(node.children, collapsed));
    }
  }
  return result;
}

function findNodeByPath(
  nodes: FileTreeNode[],
  path: string,
): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.type === "folder") {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function getActiveParent(
  selectedPath: string | null,
  selectedFolder: string | null,
): string {
  if (selectedFolder) return selectedFolder;
  if (selectedPath) {
    const lastSlash = selectedPath.lastIndexOf("/");
    return lastSlash <= 0 ? "/" : selectedPath.slice(0, lastSlash);
  }
  return "/";
}

export default function FileTree({
  nodes,
  selectedPath,
  mainDocumentId,
  myRole,
  onSelectFile,
  onAction,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const lastClickedRef = useRef<string | null>(null);
  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [contextMenu]);

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleClick(e: React.MouseEvent, node: FileTreeNode) {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrl) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      lastClickedRef.current = node.path;
      return;
    }

    if (isShift && lastClickedRef.current) {
      const visible = flattenVisiblePaths(nodes, collapsed);
      const startIdx = visible.indexOf(lastClickedRef.current);
      const endIdx = visible.indexOf(node.path);
      if (startIdx !== -1 && endIdx !== -1) {
        const from = Math.min(startIdx, endIdx);
        const to = Math.max(startIdx, endIdx);
        const range = visible.slice(from, to + 1);
        setMultiSelected(new Set(range));
        return;
      }
    }

    // Regular click — clear multi-selection
    setMultiSelected(new Set());
    lastClickedRef.current = node.path;

    if (node.type === "folder") {
      setSelectedFolder(node.path);
      onSelectFile(null);
    } else {
      setSelectedFolder(null);
      const fileNode = node as FileTreeFileNode;
      onSelectFile({
        documentId: fileNode.documentId,
        path: fileNode.path,
        documentKind: fileNode.documentKind,
        mime: fileNode.mime,
      });
    }
  }

  function handleContextMenu(e: React.MouseEvent, node: FileTreeNode) {
    if (!canMutate(myRole)) return;
    e.preventDefault();

    if (multiSelected.size > 0 && multiSelected.has(node.path)) {
      setContextMenu({ node: null, x: e.clientX, y: e.clientY });
    } else {
      setMultiSelected(new Set());
      setContextMenu({ node, x: e.clientX, y: e.clientY });
    }
  }

  const activeParent = getActiveParent(selectedPath, selectedFolder);

  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const path = event.active.id as string;
    setDraggedPath(path);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedPath(null);
    const { active, over } = event;
    if (!over || !canMutate(myRole)) return;

    const sourcePath = active.id as string;
    const destFolder = over.id as string;

    // Don't move onto itself or into its own subtree
    if (sourcePath === destFolder || destFolder.startsWith(sourcePath + "/"))
      return;

    // Check if this is a bulk drag (source is part of multi-selection)
    if (multiSelected.size > 1 && multiSelected.has(sourcePath)) {
      const items: { path: string; name: string }[] = [];
      for (const p of multiSelected) {
        const found = findNodeByPath(nodes, p);
        if (found) items.push({ path: found.path, name: found.name });
      }
      onAction({
        type: "move-multiple",
        items,
        destination: destFolder,
      });
      setMultiSelected(new Set());
    } else {
      const sourceNode = findNodeByPath(nodes, sourcePath);
      if (sourceNode) {
        onAction({
          type: "move",
          path: sourceNode.path,
          name: sourceNode.name,
          destination: destFolder,
        });
      }
    }
  }

  const draggedNode = draggedPath ? findNodeByPath(nodes, draggedPath) : null;
  const sortedNodes = useMemo(() => sortNodes(nodes), [nodes]);

  const dragLabel = draggedNode
    ? multiSelected.size > 1 && multiSelected.has(draggedPath!)
      ? `${multiSelected.size} items`
      : draggedNode.name
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col">
        {canMutate(myRole) && (
          <div className="relative border-b px-2 py-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setToolbarMenuOpen((v) => !v)}
            >
              New
            </Button>
            {toolbarMenuOpen && (
              <ToolbarMenu
                onAction={(action) => {
                  setToolbarMenuOpen(false);
                  onAction(action);
                }}
                onClose={() => setToolbarMenuOpen(false)}
                activeParent={activeParent}
              />
            )}
          </div>
        )}

        <DroppableRoot>
          <div className="flex-1 overflow-y-auto py-1" data-testid="file-tree">
            {nodes.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No files yet
              </p>
            )}
            {sortedNodes.map((node) => (
              <FileTreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                collapsed={collapsed}
                selectedPath={selectedPath}
                selectedFolder={selectedFolder}
                mainDocumentId={mainDocumentId}
                multiSelected={multiSelected}
                isDragging={draggedPath !== null}
                canDrag={canMutate(myRole)}
                onToggleFolder={toggleFolder}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </DroppableRoot>

        {contextMenu && (
          <ContextMenuOverlay
            menu={contextMenu}
            mainDocumentId={mainDocumentId}
            multiSelected={multiSelected}
            nodes={nodes}
            onClose={closeMenu}
            onAction={(action) => {
              onAction(action);
              closeMenu();
              setMultiSelected(new Set());
            }}
          />
        )}
      </div>
      <DragOverlay>
        {dragLabel && (
          <div className="rounded border bg-popover px-2 py-1 text-sm shadow-md">
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableRoot({ children }: { children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: "/" });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 overflow-hidden ${isOver ? "ring-2 ring-inset ring-primary/30" : ""}`}
    >
      {children}
    </div>
  );
}

type NodeRowProps = {
  node: FileTreeNode;
  depth: number;
  collapsed: Set<string>;
  selectedPath: string | null;
  selectedFolder: string | null;
  mainDocumentId: string | null;
  multiSelected: Set<string>;
  isDragging: boolean;
  canDrag: boolean;
  onToggleFolder: (path: string) => void;
  onClick: (e: React.MouseEvent, node: FileTreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void;
};

function FileTreeNodeRow(props: NodeRowProps) {
  if (props.node.type === "folder") {
    return <FolderRow {...props} />;
  }
  return <FileRow {...props} />;
}

function FolderRow({
  node,
  depth,
  collapsed,
  selectedPath,
  selectedFolder,
  mainDocumentId,
  multiSelected,
  isDragging,
  canDrag,
  onToggleFolder,
  onClick,
  onContextMenu,
}: NodeRowProps) {
  const paddingLeft = 8 + depth * 16;
  const isCollapsed = collapsed.has(node.path);
  const isMultiSelected = multiSelected.has(node.path);
  const isFolderSelected = selectedFolder === node.path;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging: isThisDragging,
  } = useDraggable({ id: node.path, disabled: !canDrag });

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: node.path,
  });

  const sortedChildren = useMemo(
    () => sortNodes(node.type === "folder" ? node.children : []),
    [node],
  );

  return (
    <>
      <div ref={setDropRef}>
        <button
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className={`flex w-full items-center gap-1 px-1 py-0.5 text-left text-sm hover:bg-accent ${
            isOver && isDragging
              ? "bg-primary/20 ring-1 ring-primary"
              : isMultiSelected
                ? "bg-accent/60"
                : isFolderSelected
                  ? "bg-accent font-medium"
                  : ""
          } ${isThisDragging ? "opacity-50" : ""}`}
          style={{ paddingLeft }}
          onClick={(e) => onClick(e, node)}
          onContextMenu={(e) => onContextMenu(e, node)}
        >
          <span
            className="w-4 text-center text-xs text-muted-foreground"
            role="button"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(node.path);
            }}
          >
            {isCollapsed ? "▶" : "▼"}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {!isCollapsed &&
        sortedChildren.map((child) => (
          <FileTreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            selectedPath={selectedPath}
            selectedFolder={selectedFolder}
            mainDocumentId={mainDocumentId}
            multiSelected={multiSelected}
            isDragging={isDragging}
            canDrag={canDrag}
            onToggleFolder={onToggleFolder}
            onClick={onClick}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}

function FileRow({
  node,
  depth,
  selectedPath,
  mainDocumentId,
  multiSelected,
  canDrag,
  onClick,
  onContextMenu,
}: NodeRowProps) {
  const paddingLeft = 8 + depth * 16;
  const isMultiSelected = multiSelected.has(node.path);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging: isThisDragging,
  } = useDraggable({ id: node.path, disabled: !canDrag });

  const fileNode = node as FileTreeFileNode;
  const isSelected = selectedPath === node.path;
  const isMain = fileNode.documentId === mainDocumentId;

  return (
    <button
      ref={setDragRef}
      {...attributes}
      {...listeners}
      className={`flex w-full items-center gap-1 px-1 py-0.5 text-left text-sm hover:bg-accent ${
        isMultiSelected
          ? "bg-accent/60"
          : isSelected
            ? "bg-accent font-medium"
            : ""
      } ${isThisDragging ? "opacity-50" : ""}`}
      style={{ paddingLeft }}
      onClick={(e) => onClick(e, node)}
      onContextMenu={(e) => onContextMenu(e, node)}
      aria-selected={isSelected}
    >
      <span className="w-4" />
      <span className="truncate">{node.name}</span>
      {isMain && (
        <span
          className="ml-auto shrink-0 text-xs text-amber-500"
          title="Main document"
          data-testid="main-indicator"
        >
          ★
        </span>
      )}
    </button>
  );
}

function ToolbarMenu({
  onAction,
  onClose,
  activeParent,
}: {
  onAction: (action: FileTreeAction) => void;
  onClose: () => void;
  activeParent: string;
}) {
  const items: { label: string; action: FileTreeAction }[] = [
    { label: "New File", action: { type: "create", parentPath: activeParent } },
    {
      label: "New Folder",
      action: { type: "create-folder", parentPath: activeParent },
    },
    {
      label: "Upload File",
      action: { type: "upload", parentPath: activeParent },
    },
  ];

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first =
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const btns = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        ) ?? [],
      );
      const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "ArrowDown"
          ? (idx + 1) % btns.length
          : (idx - 1 + btns.length) % btns.length;
      btns[next]?.focus();
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={menuRef}
        className="absolute left-2 right-2 z-50 mt-1 rounded-md border bg-popover py-1 shadow-md"
        role="menu"
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.label}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
            role="menuitem"
            onClick={() => onAction(item.action)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

function ContextMenuOverlay({
  menu,
  mainDocumentId,
  multiSelected,
  nodes,
  onClose,
  onAction,
}: {
  menu: NonNullable<ContextMenuState>;
  mainDocumentId: string | null;
  multiSelected: Set<string>;
  nodes: FileTreeNode[];
  onClose: () => void;
  onAction: (action: FileTreeAction) => void;
}) {
  const { node, x, y } = menu;

  // Multi-select context menu — only show bulk delete
  if (node === null && multiSelected.size > 1) {
    const items: { path: string; name: string }[] = [];
    for (const path of multiSelected) {
      const found = findNodeByPath(nodes, path);
      if (found) items.push({ path: found.path, name: found.name });
    }

    return (
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} />
        <div
          className="fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md"
          style={{ left: x, top: y }}
          role="menu"
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => onAction({ type: "move-multiple", items })}
          >
            Move {items.length} items
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => onAction({ type: "delete-multiple", items })}
          >
            Delete {items.length} items
          </button>
        </div>
      </>
    );
  }

  if (!node) return null;

  const isFile = node.type === "file";
  const fileNode = isFile ? (node as FileTreeFileNode) : null;

  const items: { label: string; action: FileTreeAction }[] = [];

  if (!isFile) {
    items.push({
      label: "New File",
      action: { type: "create", parentPath: node.path },
    });
    items.push({
      label: "New Folder",
      action: { type: "create-folder", parentPath: node.path },
    });
    items.push({
      label: "Upload File",
      action: { type: "upload", parentPath: node.path },
    });
  }

  items.push({
    label: "Rename",
    action: { type: "rename", path: node.path, currentName: node.name },
  });

  items.push({
    label: "Move",
    action: { type: "move", path: node.path, name: node.name },
  });

  items.push({
    label: "Delete",
    action: { type: "delete", path: node.path, name: node.name },
  });

  if (
    fileNode &&
    fileNode.documentKind === "text" &&
    fileNode.documentId !== mainDocumentId
  ) {
    items.push({
      label: "Set as Main Document",
      action: {
        type: "set-main",
        documentId: fileNode.documentId,
        path: fileNode.path,
      },
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md"
        style={{ left: x, top: y }}
        role="menu"
      >
        {items.map((item) => (
          <button
            key={item.label}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => onAction(item.action)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
