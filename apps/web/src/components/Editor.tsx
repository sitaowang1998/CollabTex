import { useEffect, useRef, useState, useCallback } from "react";
import {
  EditorView,
  lineNumbers,
  drawSelection,
  showTooltip,
  type Tooltip,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { EditorState, StateField, StateEffect } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";
import { bracketMatching } from "@codemirror/language";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import type { ProjectRole, CommentThread } from "@collab-tex/shared";
import { getSocket } from "@/lib/socket";
import { YjsDocumentSync } from "@/lib/yjs-sync";
import { getLanguageExtension } from "@/lib/latex-language";
import { syntaxHighlightTheme } from "@/lib/editor-theme";
import { Button } from "@/components/ui/button";
import type { CommentSelection } from "@/components/CreateCommentForm";

interface EditorProps {
  projectId: string;
  documentId: string;
  path: string;
  role: ProjectRole;
  userName?: string;
  onCommentSelection?: (selection: CommentSelection) => void;
  commentThreads?: CommentThread[];
  onThreadPositionsChange?: (positions: Map<string, number>) => void;
}

const setCommentDecorations = StateEffect.define<DecorationSet>();

const commentDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setCommentDecorations)) {
        decos = effect.value;
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function decodeAnchor(b64: string, ydoc: Y.Doc): number | null {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const relPos = Y.decodeRelativePosition(bytes);
    const abs = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
    return abs?.index ?? null;
  } catch (err) {
    console.warn("[Editor] Failed to decode comment anchor:", err);
    return null;
  }
}

const editorTheme = EditorView.theme(
  {
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
    ".cm-comment-highlight": {
      backgroundColor: "rgba(255, 213, 79, 0.3)",
      borderBottom: "2px solid rgba(255, 213, 79, 0.8)",
    },
    ".cm-tooltip.cm-comment-tooltip": {
      padding: "2px",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    },
    ".cm-comment-tooltip-btn": {
      fontSize: "12px",
      padding: "4px 10px",
      borderRadius: "4px",
      border: "none",
      backgroundColor: "var(--primary)",
      color: "var(--primary-foreground)",
      cursor: "pointer",
    },
  },
  { dark: true },
);

type EditorStatus = "connecting" | "synced" | "error";

export default function Editor(props: EditorProps) {
  const {
    projectId,
    documentId,
    path,
    role,
    userName,
    onCommentSelection,
    commentThreads,
    onThreadPositionsChange,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncRef = useRef<YjsDocumentSync | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const [status, setStatus] = useState<EditorStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [syncGeneration, setSyncGeneration] = useState(0);
  const handleAddCommentRef = useRef<(() => void) | null>(null);
  const onCommentSelectionRef = useRef(onCommentSelection);
  const onThreadPositionsChangeRef = useRef(onThreadPositionsChange);
  useEffect(() => {
    onCommentSelectionRef.current = onCommentSelection;
    onThreadPositionsChangeRef.current = onThreadPositionsChange;
  });

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
    const canComment = role !== "reader" && !!onCommentSelection;

    const languageExtensions = getLanguageExtension(path);

    // Floating "Add Comment" tooltip on selection
    const commentTooltipField = StateField.define<Tooltip | null>({
      create: () => null,
      update(_, tr) {
        if (!canComment) return null;
        const { from, to } = tr.state.selection.main;
        if (from === to) return null;
        return {
          pos: from,
          above: true,
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-comment-tooltip";
            const btn = document.createElement("button");
            btn.textContent = "Add Comment";
            btn.className = "cm-comment-tooltip-btn";
            btn.setAttribute("data-testid", "add-comment-btn");
            btn.onmousedown = (e) => {
              e.preventDefault();
              handleAddCommentRef.current?.();
            };
            dom.appendChild(btn);
            return { dom };
          },
        };
      },
      provide: (f) => showTooltip.from(f),
    });

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        yCollab(ytext, syncRef.current.awareness, { undoManager }),
        drawSelection(),
        lineNumbers(),
        bracketMatching(),
        ...languageExtensions,
        ...(languageExtensions.length > 0 ? [syntaxHighlightTheme] : []),
        EditorView.editable.of(isEditable),
        EditorState.readOnly.of(!isEditable),
        editorTheme,
        commentDecoField,
        commentTooltipField,
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
    // onCommentSelection is accessed via onCommentSelectionRef (ref pattern)
    // so it does not need to be in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, role, syncGeneration, path]);

  const handleAddComment = useCallback(() => {
    const view = viewRef.current;
    const sync = syncRef.current;
    if (!view || !sync) return;

    const { from, to } = view.state.selection.main;
    if (from === to) return;

    const quotedText = view.state.sliceDoc(from, to);
    const ytext = sync.doc.getText("content");

    const startRelPos = Y.createRelativePositionFromTypeIndex(ytext, from);
    const endRelPos = Y.createRelativePositionFromTypeIndex(ytext, to);

    const startBytes = Y.encodeRelativePosition(startRelPos);
    const endBytes = Y.encodeRelativePosition(endRelPos);

    const startAnchorB64 = btoa(
      String.fromCharCode(...new Uint8Array(startBytes)),
    );
    const endAnchorB64 = btoa(String.fromCharCode(...new Uint8Array(endBytes)));

    // Clear selection to dismiss the tooltip
    view.dispatch({ selection: { anchor: to } });

    onCommentSelectionRef.current?.({
      startAnchorB64,
      endAnchorB64,
      quotedText,
    });
  }, []);

  // Keep handleAddCommentRef updated
  useEffect(() => {
    handleAddCommentRef.current = handleAddComment;
  });

  // Update comment highlight decorations when threads change
  useEffect(() => {
    const view = viewRef.current;
    const sync = syncRef.current;
    if (!view || !sync || !commentThreads) return;

    const ydoc = sync.doc;
    const positions = new Map<string, number>();
    const ranges: { from: number; to: number }[] = [];

    for (const thread of commentThreads) {
      const startPos = decodeAnchor(thread.startAnchor, ydoc);
      const endPos = decodeAnchor(thread.endAnchor, ydoc);
      if (startPos != null) {
        positions.set(thread.id, startPos);
      }
      if (thread.status === "open" && startPos != null && endPos != null) {
        ranges.push({
          from: Math.min(startPos, endPos),
          to: Math.max(startPos, endPos),
        });
      }
    }

    // Sort and merge overlapping ranges (RangeSetBuilder requires non-overlapping)
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    const merged: { from: number; to: number }[] = [];
    for (const r of ranges) {
      if (merged.length && r.from <= merged[merged.length - 1].to) {
        merged[merged.length - 1].to = Math.max(
          merged[merged.length - 1].to,
          r.to,
        );
      } else {
        merged.push({ ...r });
      }
    }

    const builder = new RangeSetBuilder<Decoration>();
    const highlightMark = Decoration.mark({ class: "cm-comment-highlight" });
    const docLen = view.state.doc.length;
    for (const r of merged) {
      const from = Math.max(0, Math.min(r.from, docLen));
      const to = Math.max(from, Math.min(r.to, docLen));
      if (from < to) {
        builder.add(from, to, highlightMark);
      }
    }

    view.dispatch({ effects: setCommentDecorations.of(builder.finish()) });
    onThreadPositionsChangeRef.current?.(positions);
  }, [commentThreads, syncGeneration]);

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
