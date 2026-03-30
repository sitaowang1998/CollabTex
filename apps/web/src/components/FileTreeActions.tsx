import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
} from "react";
import type { ProjectDocumentResponse } from "@collab-tex/shared";
import type { FileTreeAction } from "@/components/FileTree";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function parentDir(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : path.slice(0, lastSlash);
}

function computeCommonParent(paths: string[]): string {
  if (paths.length === 0) return "/";
  const parents = paths.map((p) => parentDir(p));
  let common = parents[0];
  for (let i = 1; i < parents.length; i++) {
    while (
      common !== "/" &&
      !parents[i].startsWith(common + "/") &&
      parents[i] !== common
    ) {
      common = parentDir(common);
    }
  }
  return common;
}

type FileTreeActionsProps = {
  projectId: string;
  action: FileTreeAction | null;
  localFolderPaths: ReadonlySet<string>;
  onClose: () => void;
  onComplete: (created?: {
    documentId: string;
    path: string;
    documentKind: "text" | "binary";
    mime: string | null;
  }) => void;
  onMainDocumentChange: (documentId: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
};

export default function FileTreeActions({
  projectId,
  action,
  localFolderPaths,
  onClose,
  onComplete,
  onMainDocumentChange,
  onCreateFolder,
}: FileTreeActionsProps) {
  if (!action) return null;

  if (action.type === "set-main") {
    return (
      <SetMainAction
        projectId={projectId}
        action={action}
        onClose={onClose}
        onMainDocumentChange={onMainDocumentChange}
      />
    );
  }

  if (action.type === "delete-multiple") {
    return (
      <DeleteMultipleAction
        projectId={projectId}
        action={action}
        localFolderPaths={localFolderPaths}
        onClose={onClose}
        onComplete={onComplete}
      />
    );
  }

  if (action.type === "delete") {
    return (
      <DeleteAction
        projectId={projectId}
        action={action}
        localFolderPaths={localFolderPaths}
        onClose={onClose}
        onComplete={onComplete}
      />
    );
  }

  if (action.type === "move") {
    return (
      <MoveAction
        projectId={projectId}
        action={action}
        onClose={onClose}
        onComplete={onComplete}
      />
    );
  }

  if (action.type === "move-multiple") {
    return (
      <MoveMultipleAction
        projectId={projectId}
        action={action}
        localFolderPaths={localFolderPaths}
        onClose={onClose}
        onComplete={onComplete}
      />
    );
  }

  if (action.type === "rename") {
    return (
      <RenameAction
        projectId={projectId}
        action={action}
        onClose={onClose}
        onComplete={onComplete}
      />
    );
  }

  if (action.type === "upload") {
    return (
      <UploadAction
        projectId={projectId}
        action={action}
        onClose={onClose}
        onComplete={onComplete}
      />
    );
  }

  if (action.type === "create-folder") {
    return (
      <CreateFolderAction
        action={action}
        onClose={onClose}
        onCreateFolder={onCreateFolder}
      />
    );
  }

  return (
    <CreateAction
      projectId={projectId}
      action={action}
      onClose={onClose}
      onComplete={onComplete}
    />
  );
}

function ModalOverlay({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </div>
  );
}

function CreateAction({
  projectId,
  action,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "create" }>;
  onClose: () => void;
  onComplete: (created?: {
    documentId: string;
    path: string;
    documentKind: "text" | "binary";
    mime: string | null;
  }) => void;
}) {
  const displayPrefix =
    action.parentPath === "/" ? "" : `${action.parentPath.slice(1)}/`;
  const [path, setPath] = useState(displayPrefix);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(displayPrefix.length, displayPrefix.length);
      }
    }, 0);
  }, [displayPrefix]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = path.trim();
    if (!trimmed) {
      setError("File path is required");
      return;
    }

    const apiPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;

    setIsSubmitting(true);
    try {
      const { document } = await api.post<ProjectDocumentResponse>(
        `/projects/${projectId}/files`,
        { path: apiPath, kind: "text" },
      );
      onComplete({
        documentId: document.id,
        path: document.path,
        documentKind: document.kind,
        mime: document.mime,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error("Create file failed:", err);
        setError("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalOverlay label="Create file" onClose={onClose}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">New File</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-path">File path</Label>
              <Input
                ref={inputRef}
                id="file-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
            {error && (
              <div className="text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function CreateFolderAction({
  action,
  onClose,
  onCreateFolder,
}: {
  action: Extract<FileTreeAction, { type: "create-folder" }>;
  onClose: () => void;
  onCreateFolder: (parentPath: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name is required");
      return;
    }
    if (trimmed.includes("/")) {
      setError("Folder name cannot contain /");
      return;
    }

    onCreateFolder(action.parentPath, trimmed);
    onClose();
  }

  return (
    <ModalOverlay label="Create folder" onClose={onClose}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">New Folder</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder name</Label>
              <Input
                ref={inputRef}
                id="folder-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && (
              <div className="text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function RenameAction({
  projectId,
  action,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "rename" }>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [name, setName] = useState(action.currentName);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.patch(`/projects/${projectId}/nodes/rename`, {
        path: action.path,
        name: trimmed,
      });
      onComplete();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error("Rename failed:", err);
        setError("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalOverlay label="Rename" onClose={onClose}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">Rename</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">New name</Label>
              <Input
                ref={inputRef}
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && (
              <div className="text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Renaming…" : "Rename"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function DeleteAction({
  projectId,
  action,
  localFolderPaths,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "delete" }>;
  localFolderPaths: ReadonlySet<string>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDelete() {
    setError("");
    setIsSubmitting(true);
    try {
      if (!localFolderPaths.has(action.path)) {
        await api.delete(`/projects/${projectId}/nodes`, {
          path: action.path,
        });
      }
      onComplete();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error("Delete failed:", err);
        setError("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalOverlay label="Delete confirmation" onClose={onClose}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h2 className="text-xl font-semibold">Delete</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Delete <strong>{action.name}</strong>? This cannot be undone.
          </p>
          {error && (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isSubmitting}
              onClick={handleDelete}
            >
              {isSubmitting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function DeleteMultipleAction({
  projectId,
  action,
  localFolderPaths,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "delete-multiple" }>;
  localFolderPaths: ReadonlySet<string>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDelete() {
    setError("");
    setIsSubmitting(true);
    let anySucceeded = false;
    try {
      // Filter out children whose parent folder is also selected (redundant)
      const allPaths = action.items.map((i) => i.path);
      const filtered = action.items.filter(
        (item) =>
          !allPaths.some(
            (p) => p !== item.path && item.path.startsWith(p + "/"),
          ),
      );
      // Skip API calls for local-only folders
      for (const item of filtered) {
        if (!localFolderPaths.has(item.path)) {
          await api.delete(`/projects/${projectId}/nodes`, {
            path: item.path,
          });
        }
        anySucceeded = true;
      }
      onComplete();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error("Delete failed:", err);
        setError("An unexpected error occurred");
      }
      if (anySucceeded) onComplete();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalOverlay label="Delete confirmation" onClose={onClose}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h2 className="text-xl font-semibold">Delete</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Delete <strong>{action.items.length} items</strong>? This cannot be
            undone.
          </p>
          {error && (
            <>
              <div className="text-sm text-destructive" role="alert">
                {error}
              </div>
              <p className="text-xs text-muted-foreground">
                Some items may have been deleted.
              </p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {error ? (
              <Button
                onClick={() => {
                  onComplete();
                  onClose();
                }}
              >
                Done
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={isSubmitting}
                onClick={handleDelete}
              >
                {isSubmitting ? "Deleting…" : "Delete"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function MoveAction({
  projectId,
  action,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "move" }>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [destination, setDestination] = useState(action.destination ?? "/");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = destination.trim();
    const destinationParentPath = !trimmed || trimmed === "/" ? null : trimmed;

    setIsSubmitting(true);
    try {
      await api.patch(`/projects/${projectId}/nodes/move`, {
        path: action.path,
        destinationParentPath,
      });
      onComplete();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error("Move failed:", err);
        setError("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalOverlay label="Move" onClose={onClose}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">Move {action.name}</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="move-destination">Destination folder</Label>
              <Input
                ref={inputRef}
                id="move-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="/ (root)"
              />
            </div>
            {error && (
              <div className="text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Moving…" : "Move"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function MoveMultipleAction({
  projectId,
  action,
  localFolderPaths,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "move-multiple" }>;
  localFolderPaths: ReadonlySet<string>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [destination, setDestination] = useState(action.destination ?? "/");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = destination.trim();
    const baseDest = !trimmed || trimmed === "/" ? "" : trimmed;

    // Deduplicate: skip children whose parent folder is also selected
    const allPaths = action.items.map((i) => i.path);
    const filtered = action.items.filter(
      (item) =>
        !allPaths.some((p) => p !== item.path && item.path.startsWith(p + "/")),
    );

    // Compute common parent to preserve relative structure
    const commonParent = computeCommonParent(filtered.map((i) => i.path));

    setIsSubmitting(true);
    let anySucceeded = false;
    try {
      for (const item of filtered) {
        if (!localFolderPaths.has(item.path)) {
          // Compute per-item destination preserving relative structure
          const itemParent = parentDir(item.path);
          const relativeParent =
            itemParent === commonParent
              ? ""
              : commonParent === "/"
                ? itemParent
                : itemParent.slice(commonParent.length);
          const itemDest = baseDest + relativeParent;
          const destinationParentPath =
            !itemDest || itemDest === "/" ? null : itemDest;

          await api.patch(`/projects/${projectId}/nodes/move`, {
            path: item.path,
            destinationParentPath,
          });
        }
        anySucceeded = true;
      }
      onComplete();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error("Move failed:", err);
        setError("An unexpected error occurred");
      }
      if (anySucceeded) onComplete();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalOverlay label="Move items" onClose={onClose}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">
            Move {action.items.length} items
          </h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="move-multi-destination">Destination folder</Label>
              <Input
                ref={inputRef}
                id="move-multi-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="/ (root)"
              />
            </div>
            {error && (
              <>
                <div className="text-sm text-destructive" role="alert">
                  {error}
                </div>
                <p className="text-xs text-muted-foreground">
                  Some items may have been moved.
                </p>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {error ? (
                <Button
                  onClick={() => {
                    onComplete();
                    onClose();
                  }}
                >
                  Done
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Moving…" : "Move"}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function UploadAction({
  projectId,
  action,
  onClose,
  onComplete,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "upload" }>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onCloseRef = useRef(onClose);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCloseRef.current = onClose;
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    function handleCancel() {
      onCloseRef.current();
    }
    input.addEventListener("cancel", handleCancel);
    input.click();

    return () => {
      input.removeEventListener("cancel", handleCancel);
      abortRef.current?.abort();
    };
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        onCloseRef.current();
        return;
      }

      setFileName(file.name);
      setIsUploading(true);
      setError("");

      const parentPath = action.parentPath;
      const filePath =
        parentPath === "/" ? `/${file.name}` : `${parentPath}/${file.name}`;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await api.uploadBinaryFile<ProjectDocumentResponse>(
          `/projects/${projectId}/files/upload`,
          file,
          filePath,
          { signal: controller.signal },
        );
        onCompleteRef.current();
        onCloseRef.current();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError) {
          setError(
            err.status === 413
              ? "File too large. Maximum size is 50 MB."
              : err.message,
          );
        } else {
          console.error("Upload failed:", err);
          setError("An unexpected error occurred");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsUploading(false);
        }
      }
    },
    [projectId, action.parentPath],
  );

  if (!isUploading && !error) {
    return (
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
      />
    );
  }

  if (error) {
    return (
      <ModalOverlay label="Upload error" onClose={onClose}>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <h2 className="text-xl font-semibold">Upload Error</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay label="Uploading file" onClose={onClose}>
      <Card className="w-full max-w-sm">
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground">Uploading {fileName}…</p>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}

function SetMainAction({
  projectId,
  action,
  onClose,
  onMainDocumentChange,
}: {
  projectId: string;
  action: Extract<FileTreeAction, { type: "set-main" }>;
  onClose: () => void;
  onMainDocumentChange: (documentId: string) => void;
}) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const onCloseRef = useRef(onClose);
  const onChangeRef = useRef(onMainDocumentChange);
  useEffect(() => {
    onCloseRef.current = onClose;
    onChangeRef.current = onMainDocumentChange;
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsSubmitting(true);
      try {
        await api.put(`/projects/${projectId}/main-document`, {
          documentId: action.documentId,
        });
        if (!cancelled) {
          onChangeRef.current(action.documentId);
          onCloseRef.current();
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          console.error("Set main document failed:", err);
          setError("An unexpected error occurred");
        }
      } finally {
        if (!cancelled) setIsSubmitting(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [projectId, action.documentId]);

  if (!error) {
    return (
      <ModalOverlay label="Setting main document" onClose={onClose}>
        <Card className="w-full max-w-sm">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Setting main document…
            </p>
          </CardContent>
        </Card>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay label="Set main document error" onClose={onClose}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h2 className="text-xl font-semibold">Error</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">{error}</p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </ModalOverlay>
  );
}
