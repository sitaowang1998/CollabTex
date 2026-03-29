import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/useApiQuery";
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
  const isImage = mime?.startsWith("image/") ?? false;
  const filename = path.split("/").pop() ?? path;

  const {
    data: blob,
    isLoading: loading,
    error,
    refetch,
  } = useApiQuery<Blob | null>({
    queryFn: (signal) =>
      api.getBlob(`/projects/${projectId}/files/${documentId}/content`, {
        signal,
      }),
    deps: [projectId, documentId, mime],
    initialData: null,
    enabled: isImage,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Sync object URL with blob — this is external resource management, not derived state
  useEffect(() => {
    if (!blob) {
      setObjectUrl(null); // eslint-disable-line react-hooks/set-state-in-effect -- syncing external URL resource with React state
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

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
        <Button variant="outline" size="sm" onClick={refetch}>
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
