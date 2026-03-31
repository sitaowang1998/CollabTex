import { useEffect } from "react";
import type {
  CommentThread,
  CommentThreadCreatedEvent,
  CommentAddedEvent,
  CommentThreadStatusChangedEvent,
} from "@collab-tex/shared";
import { getSocket } from "@/lib/socket";

export function useCommentSocket({
  projectId,
  documentId,
  setThreads,
}: {
  projectId: string | undefined;
  documentId: string | undefined;
  setThreads: (updater: (prev: CommentThread[]) => CommentThread[]) => void;
}): void {
  useEffect(() => {
    if (!projectId || !documentId) return;
    const socket = getSocket();

    function handleThreadCreated(data: CommentThreadCreatedEvent) {
      if (data.projectId !== projectId || data.documentId !== documentId)
        return;
      setThreads((prev) => {
        if (prev.some((t) => t.id === data.thread.id)) return prev;
        return [...prev, data.thread];
      });
    }

    function handleCommentAdded(data: CommentAddedEvent) {
      if (data.projectId !== projectId || data.documentId !== documentId)
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
      if (data.projectId !== projectId || data.documentId !== documentId)
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
  }, [projectId, documentId, setThreads]);
}
