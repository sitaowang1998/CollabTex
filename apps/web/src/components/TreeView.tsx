import { ChevronRight, FileText, FolderOpen } from "lucide-react";
import type { FileTreeNode } from "../../../../packages/shared/src/index";
import { cn } from "../lib/utils";

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
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "folder" ? (
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 shrink-0 transition duration-200 group-open:rotate-90" />
                <FolderOpen className="h-4 w-4 shrink-0 text-sky-600" />
                <span className="truncate">{node.name}</span>
              </summary>
              <div className="ml-4 mt-1 border-l border-slate-200 pl-3">
                <TreeView
                  nodes={node.children}
                  onSelectFile={onSelectFile}
                  selectedPath={selectedPath}
                />
              </div>
            </details>
          ) : (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-950",
                selectedPath === node.path
                  ? "bg-slate-950 text-white hover:bg-slate-900 hover:text-white"
                  : "",
              )}
              onClick={() => onSelectFile(node.path)}
              type="button"
            >
              <FileText className="h-4 w-4 shrink-0" />
              {node.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
