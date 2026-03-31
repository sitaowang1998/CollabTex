import { useState, useEffect } from "react";
import type {
  ProjectSnapshot,
  ProjectSnapshotListResponse,
  ProjectSnapshotRestoreResponse,
  ProjectRole,
} from "@collab-tex/shared";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { useApiQuery } from "@/lib/useApiQuery";
import { useApiMutation } from "@/lib/useApiMutation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ErrorBlock } from "@/components/ui/error-block";

function ConfirmRestoreDialog({
  snapshot,
  isSubmitting,
  error,
  onConfirm,
  onCancel,
}: {
  snapshot: ProjectSnapshot;
  isSubmitting: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm restore"
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h2 className="text-lg font-semibold">Restore Snapshot</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This will restore the project to the state from{" "}
            {formatRelativeTime(snapshot.createdAt)}.
            {snapshot.message && (
              <>
                {" "}
                (<span className="italic">{snapshot.message}</span>)
              </>
            )}{" "}
            All current work will be replaced. A new snapshot of the current
            state will be created automatically.
          </p>
          {error && <AlertBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={isSubmitting}>
              {isSubmitting ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SnapshotPanel({
  projectId,
  myRole,
  onClose,
}: {
  projectId: string;
  myRole: ProjectRole;
  onClose: () => void;
}) {
  const {
    data: snapshots,
    isLoading,
    error,
    refetch,
  } = useApiQuery<ProjectSnapshot[]>({
    queryFn: (signal) =>
      api
        .get<ProjectSnapshotListResponse>(`/projects/${projectId}/snapshots`, {
          signal,
        })
        .then((d) => d.snapshots),
    deps: [projectId],
    initialData: [],
  });

  const [confirmSnapshot, setConfirmSnapshot] =
    useState<ProjectSnapshot | null>(null);
  const [mutationError, setMutationError] = useState("");

  const canRestore = myRole === "admin" || myRole === "editor";

  const restoreMutation = useApiMutation<
    [string],
    ProjectSnapshotRestoreResponse
  >({
    mutationFn: (snapshotId: string) =>
      api.post<ProjectSnapshotRestoreResponse>(
        `/projects/${projectId}/snapshots/${snapshotId}/restore`,
      ),
    onSuccess: () => {
      setConfirmSnapshot(null);
      setMutationError("");
      refetch();
    },
  });

  function handleRestore() {
    if (!confirmSnapshot) return;
    restoreMutation.execute(confirmSnapshot.id);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmSnapshot) return;
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, confirmSnapshot]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirmSnapshot) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Project snapshots"
    >
      <Card
        className="flex w-full max-w-lg flex-col overflow-hidden"
        style={{ maxHeight: "80vh" }}
        data-testid="snapshots-panel"
      >
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <h2 className="text-lg font-semibold">Snapshots</h2>
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close snapshots panel"
          >
            ✕
          </button>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-0">
          {isLoading && (
            <p className="p-3 text-sm text-muted-foreground">
              Loading snapshots…
            </p>
          )}

          {!isLoading && error && (
            <ErrorBlock className="p-3" message={error} onRetry={refetch} />
          )}

          {mutationError && (
            <div className="border-b px-3 py-2">
              <AlertBanner
                message={mutationError}
                onDismiss={() => setMutationError("")}
                className="text-xs"
              />
            </div>
          )}

          {!isLoading && !error && snapshots.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              No snapshots yet.
            </p>
          )}

          {!isLoading && !error && snapshots.length > 0 && (
            <ul className="divide-y" role="list" aria-label="Project snapshots">
              {snapshots.map((snapshot) => (
                <li
                  key={snapshot.id}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">
                      {formatRelativeTime(snapshot.createdAt)}
                    </p>
                    {snapshot.message && (
                      <p className="truncate text-sm">{snapshot.message}</p>
                    )}
                  </div>
                  {canRestore && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmSnapshot(snapshot)}
                      disabled={restoreMutation.isSubmitting}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {confirmSnapshot && (
        <ConfirmRestoreDialog
          snapshot={confirmSnapshot}
          isSubmitting={restoreMutation.isSubmitting}
          error={restoreMutation.error}
          onConfirm={handleRestore}
          onCancel={() => {
            if (restoreMutation.error) {
              setMutationError(restoreMutation.error);
            }
            setConfirmSnapshot(null);
            restoreMutation.reset();
          }}
        />
      )}
    </div>
  );
}
