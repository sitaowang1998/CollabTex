import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface BinaryPreviewProps {
  projectId: string;
  documentId: string;
  path: string;
  mime: string | null;
}

export default function BinaryPreview({
  projectId,
  documentId,
  path,
  mime,
}: BinaryPreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const isImage = mime?.startsWith("image/") ?? false;
  const filename = path.split("/").pop() ?? path;

  useEffect(() => {
    if (!isImage) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchBinary() {
      setLoading(true);
      setError(null);

      try {
        const blob = await api.getBlob(
          `/projects/${projectId}/files/${documentId}/content`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        console.error("BinaryPreview fetch failed:", err);
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load file";
        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchBinary();

    return () => {
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [projectId, documentId, mime, isImage, retryCount]);

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

  if (isImage && objectUrl) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <img
          src={objectUrl}
          alt={filename}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <p className="text-sm font-medium">{filename}</p>
      <p className="text-xs text-muted-foreground">{mime ?? "Binary file"}</p>
    </div>
  );
}
