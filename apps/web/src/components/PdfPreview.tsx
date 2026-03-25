import { useState, useEffect, useRef, useCallback } from "react";
import type { ProjectRole, CompileDoneEvent } from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Button } from "@/components/ui/button";

type CompileStatus = "idle" | "compiling" | "success" | "failure";

type Props = {
  projectId: string;
  role: ProjectRole;
};

export default function PdfPreview({ projectId, role }: Props) {
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const pdfUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const fetchControllerRef = useRef<AbortController | null>(null);

  const canCompile = role === "admin" || role === "editor";

  const revokePdfUrl = useCallback(() => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
  }, []);

  // Returns true if a PDF was loaded, false if 404 (no PDF available)
  const fetchPdf = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      // Abort any previous non-initial fetch
      fetchControllerRef.current?.abort();
      const controller = new AbortController();
      fetchControllerRef.current = controller;

      // Combine with the provided signal (from initial load)
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

      try {
        const blob = await api.getBlob(`/projects/${projectId}/compile/pdf`, {
          signal: combinedSignal,
        });
        if (combinedSignal.aborted || !mountedRef.current) return false;
        revokePdfUrl();
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
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
    [projectId, revokePdfUrl],
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
      revokePdfUrl();
    };
  }, [projectId, fetchPdf, revokePdfUrl]);

  // Listen for compile:done socket events
  useEffect(() => {
    const socket = getSocket();

    function handleCompileDone(data: CompileDoneEvent) {
      if (data.projectId !== projectId || !mountedRef.current) return;

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

    socket.on("compile:done", handleCompileDone);
    return () => {
      socket.off("compile:done", handleCompileDone);
    };
  }, [projectId, fetchPdf]);

  async function handleCompile() {
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
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {pdfUrl ? (
          <iframe
            title="PDF preview"
            src={pdfUrl}
            className="h-full w-full flex-1 border-0"
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
