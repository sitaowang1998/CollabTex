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
  // Listen for file tree changes broadcast to the project room
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

  // Listen for snapshot restore — clear selection, refetch tree, and re-sync editor
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();

    function handleSnapshotRestored(data: SnapshotRestoredEvent) {
      if (data.projectId !== projectId) return;
      onSnapshotRestored();
    }

    socket.on("snapshot:restored", handleSnapshotRestored);
    return () => {
      socket.off("snapshot:restored", handleSnapshotRestored);
    };
  }, [projectId, onSnapshotRestored]);
}
