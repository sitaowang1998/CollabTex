import { useEffect } from "react";
import type {
  FileTreeChangedEvent,
  SnapshotRestoredEvent,
} from "@collab-tex/shared";
import { getSocket } from "@/lib/socket";

export function useProjectSocket({
  projectId,
  refreshTree,
  onSnapshotRestored,
}: {
  projectId: string | undefined;
  refreshTree: () => Promise<void>;
  onSnapshotRestored: () => void;
}): void {
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    function handleTreeChanged(data: FileTreeChangedEvent) {
      if (data.projectId !== projectId) return;
      refreshTree().catch((err) => console.error("Tree refresh failed:", err));
    }

    function handleSnapshotRestored(data: SnapshotRestoredEvent) {
      if (data.projectId !== projectId) return;
      onSnapshotRestored();
    }

    socket.on("project:tree_changed", handleTreeChanged);
    socket.on("snapshot:restored", handleSnapshotRestored);

    return () => {
      socket.off("project:tree_changed", handleTreeChanged);
      socket.off("snapshot:restored", handleSnapshotRestored);
    };
  }, [projectId, refreshTree, onSnapshotRestored]);
}
