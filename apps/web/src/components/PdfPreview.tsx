import { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ProjectRole, CompileDoneEvent } from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type CompileStatus = "idle" | "compiling" | "success" | "failure";

type Props = {
  projectId: string;
  projectName: string;
  role: ProjectRole;
};

async function renderPages(
  pdf: PDFDocumentProxy,
  container: HTMLElement,
  isStale?: () => boolean,
): Promise<void> {
  // Remove existing canvases safely
  while (container.firstChild) container.removeChild(container.firstChild);

  const containerWidth = container.clientWidth;
  if (containerWidth <= 0) return;

  for (let i = 1; i <= pdf.numPages; i++) {
    if (isStale?.()) return;
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = scaledViewport.width * window.devicePixelRatio;
    canvas.height = scaledViewport.height * window.devicePixelRatio;
    canvas.style.width = `${scaledViewport.width}px`;
    canvas.style.height = `${scaledViewport.height}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn(`[PdfPreview] Failed to get 2d context for page ${i}`);
      continue;
    }
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport,
      canvas,
    }).promise;
  }
}

export default function PdfPreview({ projectId, projectName, role }: Props) {
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const mountedRef = useRef(true);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderedWidthRef = useRef(0);
  const renderGenRef = useRef(0);
  const isCompilingRef = useRef(false);
  const pendingSocketEventRef = useRef<CompileDoneEvent | null>(null);
  const compileDoneHandlerRef = useRef<
    ((data: CompileDoneEvent) => void) | null
  >(null);

  const canCompile = role === "admin" || role === "editor";

  const fetchPdf = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      fetchControllerRef.current?.abort();
      const controller = new AbortController();
      fetchControllerRef.current = controller;

      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      try {
        const blob = await api.getBlob(`/projects/${projectId}/compile/pdf`, {
          signal: combinedSignal,
        });
        if (combinedSignal.aborted || !mountedRef.current) return false;
        const buffer = await blob.arrayBuffer();
        if (combinedSignal.aborted || !mountedRef.current) return false;
        setPdfData(buffer);
        setCompileStatus("success");
        setLogs("");
        setError("");
        return true;
      } catch (err) {
        if (combinedSignal.aborted || !mountedRef.current) return false;
        if (err instanceof ApiError && err.status === 404) {
          return false;
        }
        throw err;
      }
    },
    [projectId],
  );

  // Load existing PDF on mount
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    async function loadInitialPdf() {
      try {
        await fetchPdf(controller.signal);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Failed to load initial PDF:", err);
        setError(err instanceof ApiError ? err.message : "Failed to load PDF");
      } finally {
        if (!controller.signal.aborted && mountedRef.current) {
          setInitialLoading(false);
        }
      }
    }

    loadInitialPdf();

    return () => {
      mountedRef.current = false;
      controller.abort();
      fetchControllerRef.current?.abort();
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    };
  }, [projectId, fetchPdf]);

  // Render PDF with pdf.js when pdfData changes + re-render on resize
  useEffect(() => {
    if (!pdfData || !canvasContainerRef.current) return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      const loadingTask = pdfjsLib.getDocument({ data: pdfData!.slice(0) });
      const doc = await loadingTask.promise;
      if (cancelled) {
        doc.destroy();
        return;
      }
      pdfDocRef.current?.destroy();
      pdfDocRef.current = doc;

      const container = canvasContainerRef.current;
      if (!container) return;

      await renderPages(doc, container);
      renderedWidthRef.current = container.clientWidth;

      // Set up resize observer after initial render
      observer = new ResizeObserver(() => {
        const currentWidth = container.clientWidth;
        const rw = renderedWidthRef.current;

        // When enlarging, use CSS transform to fill the gap instantly
        // When shrinking, max-width:100% on canvases handles it via CSS
        if (rw > 0 && currentWidth > rw) {
          const scaleX = currentWidth / rw;
          container.style.transformOrigin = "top left";
          container.style.transform = `scaleX(${scaleX})`;
        } else {
          container.style.transform = "";
        }

        // Debounced full re-render at correct resolution
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!cancelled && pdfDocRef.current && canvasContainerRef.current) {
            const gen = ++renderGenRef.current;
            canvasContainerRef.current.style.transform = "";
            renderPages(
              pdfDocRef.current,
              canvasContainerRef.current,
              () => renderGenRef.current !== gen,
            )
              .then(() => {
                if (renderGenRef.current === gen) {
                  renderedWidthRef.current =
                    canvasContainerRef.current?.clientWidth ?? 0;
                }
              })
              .catch((err) => {
                if (!cancelled) {
                  console.error("Failed to re-render PDF on resize:", err);
                }
              });
          }
        }, 300);
      });
      observer.observe(container);
    }

    load().catch((err) => {
      if (!cancelled) console.error("Failed to render PDF:", err);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [pdfData]);

  // Listen for compile:done socket events
  useEffect(() => {
    const socket = getSocket();

    function handleCompileDone(data: CompileDoneEvent) {
      if (data.projectId !== projectId || !mountedRef.current) return;
      if (isCompilingRef.current) {
        pendingSocketEventRef.current = data;
        return;
      }

      if (data.status === "success") {
        setLogs("");
        setError("");
        setCompileStatus("compiling");
        fetchPdf()
          .then((loaded) => {
            if (!mountedRef.current) return;
            if (!loaded) {
              setError("Compile reported success but no PDF is available");
              setCompileStatus("failure");
            }
          })
          .catch((err) => {
            if (!mountedRef.current) return;
            setError(
              err instanceof ApiError ? err.message : "Failed to load PDF",
            );
            setCompileStatus("failure");
          });
      } else {
        setCompileStatus("failure");
        setLogs(data.logs);
        setError("");
      }
    }

    compileDoneHandlerRef.current = handleCompileDone;
    socket.on("compile:done", handleCompileDone);
    return () => {
      compileDoneHandlerRef.current = null;
      socket.off("compile:done", handleCompileDone);
    };
  }, [projectId, fetchPdf]);

  async function handleCompile() {
    isCompilingRef.current = true;
    setCompileStatus("compiling");
    setError("");
    setLogs("");

    try {
      const result = await api.post<{
        status: "success" | "failure";
        logs: string;
      }>(`/projects/${projectId}/compile`);
      if (!mountedRef.current) return;

      if (result.status === "success") {
        try {
          const loaded = await fetchPdf();
          if (!mountedRef.current) return;
          if (!loaded) {
            setError("Compile succeeded but no PDF is available");
            setCompileStatus("failure");
          }
        } catch (fetchErr) {
          if (!mountedRef.current) return;
          setError(
            fetchErr instanceof ApiError
              ? `Compile succeeded but failed to load PDF: ${fetchErr.message}`
              : "Compile succeeded but failed to load PDF",
          );
          setCompileStatus("failure");
        }
      } else {
        setCompileStatus("failure");
        setLogs(result.logs);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 409) {
        setError("Compile already in progress");
        setCompileStatus("idle");
      } else {
        setError(err instanceof ApiError ? err.message : "Compile failed");
        setCompileStatus("failure");
      }
    } finally {
      isCompilingRef.current = false;
      const pending = pendingSocketEventRef.current;
      if (pending) {
        pendingSocketEventRef.current = null;
        compileDoneHandlerRef.current?.(pending);
      }
    }
  }

  function handleDownload() {
    if (!pdfData) return;
    let url: string | undefined;
    try {
      const blob = new Blob([pdfData], { type: "application/pdf" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName =
        projectName
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x1f\x7f]/g, "")
          .replace(/[/\\:*?"<>|]/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/^\.+$/, "")
          .trim()
          .slice(0, 200) || "output";
      a.download = `${safeName}.pdf`;
      a.click();
    } catch {
      setError("Failed to download PDF");
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  if (initialLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-2 py-1">
        {canCompile && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCompile}
            disabled={compileStatus === "compiling"}
          >
            {compileStatus === "compiling" ? "Compiling…" : "Compile"}
          </Button>
        )}
        {error && (
          <span className="truncate text-xs text-destructive">{error}</span>
        )}
        {pdfData && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="ml-auto"
          >
            <Download className="size-3.5" />
            Download
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {pdfData ? (
          <div
            ref={canvasContainerRef}
            className="flex-1 overflow-auto bg-muted/30"
            data-testid="pdf-canvas-container"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-4">
            <p className="text-center text-sm text-muted-foreground">
              {canCompile
                ? "No compiled PDF. Click Compile to build."
                : "No compiled PDF yet."}
            </p>
          </div>
        )}

        {/* Compile logs on failure */}
        {compileStatus === "failure" && logs && (
          <div className="max-h-48 shrink-0 overflow-auto border-t bg-muted/50 p-2">
            <p className="mb-1 text-xs font-medium text-destructive">
              Compile logs:
            </p>
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
              {logs}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
