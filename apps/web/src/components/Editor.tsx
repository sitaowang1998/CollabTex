import { useEffect, useRef, useState } from "react";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { bracketMatching } from "@codemirror/language";
import type { ProjectDocumentContentResponse } from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface EditorProps {
  projectId: string;
  path: string;
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", flex: "1" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    borderRight: "none",
  },
});

export default function Editor({ projectId, path }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchContent() {
      setLoading(true);
      setError(null);
      setContent(null);

      try {
        const data = await api.get<ProjectDocumentContentResponse>(
          `/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setContent(data.content ?? "");
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        console.error("Editor fetch failed:", err);
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load file content";
        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchContent();

    return () => {
      controller.abort();
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [projectId, path, retryCount]);

  // Create EditorView when content is loaded
  useEffect(() => {
    if (content === null || !containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    try {
      const state = EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          bracketMatching(),
          EditorState.readOnly.of(true),
          editorTheme,
        ],
      });

      viewRef.current = new EditorView({
        state,
        parent: containerRef.current,
      });
    } catch (err) {
      console.error("Failed to initialize editor:", err);
      setError("Failed to initialize editor. Try refreshing the page.");
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [content]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRetryCount((c) => c + 1)}
        >
          Retry
        </Button>
      </div>
    );
  }

  return <div ref={containerRef} className="flex flex-1 overflow-hidden" />;
}
