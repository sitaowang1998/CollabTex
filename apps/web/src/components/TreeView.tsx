import type { FileTreeNode } from "../../../../packages/shared/src/index";

export function TreeView({
  nodes,
  onSelectFile,
  selectedPath,
}: {
  nodes: FileTreeNode[];
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "folder" ? (
            <details open>
              <summary className="tree-folder">{node.name}</summary>
              <TreeView
                nodes={node.children}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
              />
            </details>
          ) : (
            <button
              className={
                selectedPath === node.path ? "tree-file tree-file--active" : "tree-file"
              }
              onClick={() => onSelectFile(node.path)}
              type="button"
            >
              {node.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
