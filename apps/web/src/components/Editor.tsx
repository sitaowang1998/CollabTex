import { useEffect, useRef, useState, useCallback } from "react";
import { EditorView, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { bracketMatching } from "@codemirror/language";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import type { ProjectRole } from "@collab-tex/shared";
import { getSocket } from "@/lib/socket";
import { YjsDocumentSync } from "@/lib/yjs-sync";
import { Button } from "@/components/ui/button";

interface EditorProps {
  projectId: string;
  documentId: string;
  path: string;
  role: ProjectRole;
  userName?: string;
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", flex: "1" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    borderRight: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground, #000)",
    borderLeftWidth: "2px",
  },
  ".cm-ySelectionInfo": {
    opacity: "1",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "0.7rem",
    padding: "1px 4px",
    borderRadius: "3px 3px 3px 0",
  },
});

type EditorStatus = "connecting" | "synced" | "error";

export default function Editor(props: EditorProps) {
  const { projectId, documentId, role, userName } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncRef = useRef<YjsDocumentSync | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const [status, setStatus] = useState<EditorStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [syncGeneration, setSyncGeneration] = useState(0);

  // Yjs sync lifecycle
  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    const sync = new YjsDocumentSync({
      projectId,
      documentId,
      socket,
      userName,
      onSynced: () => {
        if (cancelled) return;
        setStatus("synced");
        setSyncGeneration((g) => g + 1);
      },
      onError: (err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err.message);
      },
    });
    syncRef.current = sync;

    return () => {
      cancelled = true;
      sync.destroy();
      syncRef.current = null;

      if (undoManagerRef.current) {
        undoManagerRef.current.destroy();
        undoManagerRef.current = null;
      }
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [projectId, documentId, userName, retryCount]);

  // EditorView mount when synced
  useEffect(() => {
    if (status !== "synced" || !containerRef.current || !syncRef.current)
      return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    if (undoManagerRef.current) {
      undoManagerRef.current.destroy();
      undoManagerRef.current = null;
    }

    const ytext = syncRef.current.doc.getText("content");
    const undoManager = new Y.UndoManager(ytext);
    undoManagerRef.current = undoManager;

    const isEditable = role === "admin" || role === "editor";

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        yCollab(ytext, syncRef.current.awareness, { undoManager }),
        drawSelection(),
        lineNumbers(),
        bracketMatching(),
        EditorView.editable.of(isEditable),
        EditorState.readOnly.of(!isEditable),
        editorTheme,
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      if (undoManagerRef.current) {
        undoManagerRef.current.destroy();
        undoManagerRef.current = null;
      }
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
    // syncGeneration changes on every sync (including post-reset),
    // ensuring the EditorView re-mounts when the Y.Doc is replaced.
  }, [status, role, syncGeneration]);

  const handleRetry = useCallback(() => {
    setStatus("connecting");
    setErrorMessage(null);
    setRetryCount((c) => c + 1);
  }, []);

  if (status === "connecting") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">
          {errorMessage || "Connection failed"}
        </p>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-1 overflow-hidden"
      data-testid="editor-container"
    />
  );
}
