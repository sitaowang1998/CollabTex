import type { FileTreeNode, FileTreeFolderNode } from "@collab-tex/shared";

export type SelectedFile = {
  documentId: string;
  path: string;
  documentKind: "text" | "binary";
  mime: string | null;
};

export function removeNodeFromTree(
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

export function mergeLocalFolders(
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

export function insertFolderIntoTree(
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
