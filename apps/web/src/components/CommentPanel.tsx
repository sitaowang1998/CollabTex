import { useState, useMemo, useEffect } from "react";
import type {
  ProjectRole,
  CommentThread,
  CommentResponse,
} from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import CreateCommentForm, {
  type CommentSelection,
} from "@/components/CreateCommentForm";

type Props = {
  projectId: string;
  documentId: string;
  role: ProjectRole;
  threads: CommentThread[];
  isLoading: boolean;
  error: string;
  onRetry: () => void;
  onMutated: () => void;
  pendingSelection: CommentSelection | null;
  onClearSelection: () => void;
  threadPositions: Map<string, number>;
};

function formatRelativeTime(dateString: string): string {
  const ms = Date.now() - new Date(dateString).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function CommentPanel({
  projectId,
  documentId,
  role,
  threads,
  isLoading,
  error,
  onRetry,
  onMutated,
  pendingSelection,
  onClearSelection,
  threadPositions,
}: Props) {
  const canComment = role !== "reader";

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      const posA = threadPositions.get(a.id) ?? Infinity;
      const posB = threadPositions.get(b.id) ?? Infinity;
      if (posA !== posB) return posA - posB;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [threads, threadPositions]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading comments…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  function handleCreated() {
    onClearSelection();
    onMutated();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {pendingSelection && (
          <CreateCommentForm
            projectId={projectId}
            documentId={documentId}
            selection={pendingSelection}
            onCreated={handleCreated}
            onCancel={onClearSelection}
          />
        )}

        {sortedThreads.length === 0 && !pendingSelection ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-sm text-muted-foreground">No comments yet</p>
          </div>
        ) : (
          sortedThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              projectId={projectId}
              canComment={canComment}
              onMutated={onMutated}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  projectId,
  canComment,
  onMutated,
}: {
  thread: CommentThread;
  projectId: string;
  canComment: boolean;
  onMutated: () => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [expanded, setExpanded] = useState(thread.status === "open");

  useEffect(() => {
    setExpanded(thread.status === "open");
  }, [thread.status]);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = replyBody.trim();
    if (!trimmed) return;

    setReplySubmitting(true);
    setReplyError("");
    try {
      await api.post<CommentResponse>(
        `/projects/${projectId}/threads/${thread.id}/reply`,
        { body: trimmed },
      );
      setReplyBody("");
      onMutated();
    } catch (err) {
      setReplyError(
        err instanceof ApiError ? err.message : "Failed to post reply",
      );
    } finally {
      setReplySubmitting(false);
    }
  }

  async function handleToggleStatus() {
    const newStatus = thread.status === "open" ? "resolved" : "open";
    setStatusUpdating(true);
    setStatusError("");
    try {
      await api.patch(`/projects/${projectId}/threads/${thread.id}`, {
        status: newStatus,
      });
      onMutated();
    } catch (err) {
      setStatusError(
        err instanceof ApiError ? err.message : "Failed to update status",
      );
      onMutated();
    } finally {
      setStatusUpdating(false);
    }
  }

  const isResolved = thread.status === "resolved";

  return (
    <div className="border-b p-3" data-testid="comment-thread">
      {/* Header: status + actions + collapse toggle */}
      <div className="mb-1 flex items-center gap-2">
        <button
          className="text-xs text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse thread" : "Expand thread"}
        >
          {expanded ? "▼" : "▶"}
        </button>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            isResolved
              ? "bg-green-100 text-green-800"
              : "bg-yellow-100 text-yellow-800"
          }`}
          data-testid="thread-status"
        >
          {thread.status}
        </span>
        <span
          className="truncate text-xs italic text-muted-foreground"
          title={thread.quotedText}
        >
          {thread.quotedText.length > 40
            ? thread.quotedText.slice(0, 40) + "…"
            : thread.quotedText}
        </span>
        {statusError && (
          <span className="truncate text-xs text-destructive">
            {statusError}
          </span>
        )}
        {canComment && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-auto shrink-0 px-1.5 py-0.5 text-xs"
            onClick={handleToggleStatus}
            disabled={statusUpdating}
          >
            {isResolved ? "Reopen" : "Resolve"}
          </Button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <>
          {/* Quoted text */}
          <blockquote className="mb-2 border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-muted-foreground">
            {thread.quotedText}
          </blockquote>

          {/* Comments */}
          <div className="space-y-2">
            {thread.comments.map((comment) => (
              <div key={comment.id} data-testid="thread-comment">
                <p className="text-sm">{comment.body}</p>
                <p className="text-xs text-muted-foreground">
                  {comment.authorName ?? "Unknown"} &middot;{" "}
                  {formatRelativeTime(comment.createdAt)}
                </p>
              </div>
            ))}
          </div>

          {/* Reply form */}
          {canComment && (
            <form onSubmit={handleReply} className="mt-2">
              <textarea
                className="w-full rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                rows={2}
                placeholder="Reply…"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                disabled={replySubmitting}
                aria-label="Reply"
              />
              {replyError && (
                <p className="text-xs text-destructive">{replyError}</p>
              )}
              <Button
                type="submit"
                size="sm"
                className="mt-1"
                disabled={replySubmitting || !replyBody.trim()}
              >
                {replySubmitting ? "Replying…" : "Reply"}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
