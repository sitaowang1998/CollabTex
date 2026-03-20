import type { FormEvent } from "react";
import {
  FileImage,
  FilePlus2,
  Files,
  FolderTree,
  MessageSquareText,
  RefreshCw,
  Undo2,
} from "lucide-react";
import type { CreateFileState, WorkspaceState } from "../app/types";
import { TreeView } from "../components/TreeView";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

export function WorkspacePage({
  busy,
  canEditFiles,
  createFile,
  projectTitle,
  selectedFileLabel,
  workspace,
  workspaceBusy,
  onBackToProjects,
  onCloseCreateFile,
  onCreateFileChange,
  onCreateFileSubmit,
  onOpenCreateFile,
  onRefresh,
  onSelectFile,
}: {
  busy: boolean;
  canEditFiles: boolean;
  createFile: CreateFileState;
  projectTitle: string;
  selectedFileLabel: string;
  workspace: WorkspaceState;
  workspaceBusy: boolean;
  onBackToProjects: () => void;
  onCloseCreateFile: () => void;
  onCreateFileChange: (nextState: CreateFileState) => void;
  onCreateFileSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenCreateFile: () => void;
  onRefresh: () => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <FolderTree className="h-3.5 w-3.5" />
              Workspace shell
            </Badge>
            <Badge variant="outline">Role: {workspace.role ?? "unknown"}</Badge>
            {workspaceBusy ? <Badge variant="outline">Refreshing</Badge> : null}
          </div>
          <div className="space-y-2">
            <h2 className="font-serif text-3xl font-semibold text-slate-950">
              {projectTitle}
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Browse the file tree, preview a read-only editor shell, and show
              where PDF preview and comments will live in the collaborative
              workspace.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            disabled={!canEditFiles}
            onClick={onOpenCreateFile}
            type="button"
          >
            <FilePlus2 className="h-4 w-4" />
            New file
          </Button>
          <Button onClick={onRefresh} type="button" variant="outline">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={onBackToProjects} type="button" variant="ghost">
            <Undo2 className="h-4 w-4" />
            Back to projects
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1.5">
                <Badge variant="secondary" className="w-fit gap-1">
                  <Files className="h-3.5 w-3.5" />
                  File tree
                </Badge>
                <CardTitle>Project files</CardTitle>
                <CardDescription>
                  Select a file to populate the editor shell.
                </CardDescription>
              </div>
              <Badge variant={canEditFiles ? "default" : "outline"}>
                {canEditFiles ? "Editable" : "Read only"}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="max-h-[460px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                {workspace.tree.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
                    Add a file to create the first folder structure.
                  </div>
                ) : (
                  <TreeView
                    nodes={workspace.tree}
                    onSelectFile={onSelectFile}
                    selectedPath={workspace.selectedPath}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Project info</CardTitle>
              <CardDescription>
                Members currently visible in the workspace shell.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-900">
                  Current role
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {workspace.role ?? "unknown"}
                </p>
              </div>

              <div className="space-y-3">
                {workspace.members.map((member) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                    key={member.userId}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {member.name}
                      </p>
                      <p className="truncate text-sm text-slate-500">
                        {member.email}
                      </p>
                    </div>
                    <Badge variant="outline">{member.role}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="min-h-[640px]">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <Badge variant="secondary" className="w-fit">
                Editor
              </Badge>
              <CardTitle>Source editor</CardTitle>
              <CardDescription>
                The current milestone keeps the editor read-only while we shape
                the workspace UI and file selection flow.
              </CardDescription>
            </div>
            <Badge variant="outline">{selectedFileLabel}</Badge>
          </CardHeader>
          <CardContent>
            <Textarea
              className="min-h-[520px] resize-none font-mono text-xs leading-6 sm:text-sm"
              readOnly
              value={
                workspace.selectedPath
                  ? workspace.selectedContent
                  : "Select a file from the left tree to view its contents."
              }
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Badge variant="secondary" className="w-fit gap-1">
                <FileImage className="h-3.5 w-3.5" />
                PDF preview
              </Badge>
              <CardTitle>Preview panel</CardTitle>
              <CardDescription>
                Placeholder for rendered document preview in a future iteration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid min-h-[280px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm leading-6 text-slate-600">
                {workspace.selectedPath
                  ? "Preview rendering is intentionally omitted in this UI-only milestone."
                  : "Select a file to preview where rendered output will appear."}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Badge variant="secondary" className="w-fit gap-1">
                <MessageSquareText className="h-3.5 w-3.5" />
                Comments
              </Badge>
              <CardTitle>Discussion sidebar</CardTitle>
              <CardDescription>
                A lightweight placeholder showing where collaborative feedback
                threads will surface.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-900">
                  {workspace.members[0]?.name ?? "Reviewer"}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Workspace comments will eventually attach to document ranges
                  and discussion threads here.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-sky-50 p-4">
                <p className="text-sm font-medium text-slate-900">You</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This sidebar is present to demonstrate the responsive
                  workspace layout requested in the frontend milestone.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            onCloseCreateFile();
          }
        }}
        open={createFile.open}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a new file to the tree</DialogTitle>
            <DialogDescription>
              Use an absolute path like <code>/sections/intro.tex</code>. New
              folders will be created automatically from the path.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={onCreateFileSubmit}>
            <div className="space-y-2">
              <Label htmlFor="create-file-path">File path</Label>
              <Input
                id="create-file-path"
                onChange={(event) =>
                  onCreateFileChange({
                    ...createFile,
                    path: event.target.value,
                  })
                }
                placeholder="/sections/intro.tex"
                required
                value={createFile.path}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-file-kind">Kind</Label>
              <select
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                id="create-file-kind"
                onChange={(event) =>
                  onCreateFileChange({
                    ...createFile,
                    kind: event.target.value as "text" | "binary",
                  })
                }
                value={createFile.kind}
              >
                <option value="text">text</option>
                <option value="binary">binary</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-file-mime">MIME type</Label>
              <Input
                id="create-file-mime"
                onChange={(event) =>
                  onCreateFileChange({
                    ...createFile,
                    mime: event.target.value,
                  })
                }
                placeholder="text/plain"
                value={createFile.mime}
              />
            </div>

            <div className="flex justify-end">
              <Button disabled={busy} type="submit">
                {busy ? "Creating..." : "Create file"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
