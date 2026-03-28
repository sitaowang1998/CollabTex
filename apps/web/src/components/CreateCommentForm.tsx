import { useState, useRef, useEffect } from "react";
import type { CommentThreadResponse } from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

export type CommentSelection = {
  startAnchorB64: string;
  endAnchorB64: string;
  quotedText: string;
};

type Props = {
  projectId: string;
  documentId: string;
  selection: CommentSelection;
  onCreated: () => void;
  onCancel: () => void;
};

export default function CreateCommentForm({
  projectId,
  documentId,
  selection,
  onCreated,
  onCancel,
}: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError("");

    try {
      await api.post<CommentThreadResponse>(
        `/projects/${projectId}/docs/${documentId}/comments`,
        {
          startAnchorB64: selection.startAnchorB64,
          endAnchorB64: selection.endAnchorB64,
          quotedText: selection.quotedText,
          body: trimmed,
        },
      );
      if (!mountedRef.current) return;
      onCreated();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof ApiError ? err.message : "Failed to create comment",
      );
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-b p-3"
      data-testid="create-comment-form"
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        New comment
      </p>
      <blockquote className="mb-2 border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-muted-foreground">
        {selection.quotedText}
      </blockquote>
      <textarea
        className="mb-2 w-full rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        rows={3}
        autoFocus
        placeholder="Write a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={submitting}
        aria-label="Comment body"
      />
      {error && <p className="mb-1 text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting || !body.trim()}>
          {submitting ? "Submitting…" : "Submit"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
