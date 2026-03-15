import type { CreateFileState, WorkspaceState } from "../app/types";
import { TreeView } from "../components/TreeView";

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
  onCreateFileSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onOpenCreateFile: () => void;
  onRefresh: () => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <section className="workspace-layout workspace-layout--wireframe">
      <div className="workspace-header">
        <div>
          <h2>{projectTitle}</h2>
          <p>
            Current role: <strong>{workspace.role ?? "unknown"}</strong>
          </p>
        </div>
        <div className="workspace-header__actions">
          <button
            className="primary-button"
            disabled={!canEditFiles}
            onClick={onOpenCreateFile}
            type="button"
          >
            New file
          </button>
          <button className="ghost-button" onClick={onRefresh} type="button">
            Refresh
          </button>
          <button
            className="ghost-button"
            onClick={onBackToProjects}
            type="button"
          >
            Back to projects
          </button>
        </div>
      </div>

      <div className="workspace-grid workspace-grid--wireframe">
        <section className="panel workspace-panel workspace-panel--wireframe">
          <div className="section-heading">
            <h3>Files</h3>
            <span
              className={
                canEditFiles ? "role-badge" : "role-badge role-badge--muted"
              }
            >
              {canEditFiles ? "Editable" : "Read only"}
            </span>
          </div>

          <div className="tree-scroll tree-scroll--wireframe">
            {workspace.tree.length === 0 ? (
              <div className="empty-state empty-state--compact">
                <h3>No files yet</h3>
                <p>Add a file to create the first folder structure.</p>
              </div>
            ) : (
              <TreeView
                nodes={workspace.tree}
                onSelectFile={onSelectFile}
                selectedPath={workspace.selectedPath}
              />
            )}
          </div>

          <div className="info-card info-card--wireframe">
            <h4>Project info</h4>
            <p>
              Role: <strong>{workspace.role ?? "unknown"}</strong>
            </p>
            {workspaceBusy ? (
              <span className="loading-chip">Loading...</span>
            ) : null}
          </div>

          <div className="info-card info-card--wireframe">
            <h4>Members</h4>
            <div className="member-list">
              {workspace.members.map((member) => (
                <div className="member-row" key={member.userId}>
                  <div>
                    <strong>{member.name}</strong>
                    <p>{member.email}</p>
                  </div>
                  <span className="role-badge">{member.role}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel workspace-panel workspace-panel--wireframe">
          <div className="section-heading">
            <h3>Editor area</h3>
            <span className="path-pill">{selectedFileLabel}</span>
          </div>

          <textarea
            className="editor-surface editor-surface--wireframe"
            readOnly
            value={
              workspace.selectedPath
                ? workspace.selectedContent
                : "Select a file from the left tree to view its contents."
            }
          />
        </section>

        <section className="panel workspace-panel workspace-panel--wireframe workspace-panel--preview">
          <div className="section-heading">
            <h3>PDF preview</h3>
          </div>

          <div className="pdf-preview">
            {workspace.selectedPath
              ? "Preview unavailable in this starter."
              : "Select a file to preview."}
          </div>
        </section>

        <aside className="panel workspace-panel workspace-panel--wireframe workspace-panel--comments">
          <div className="section-heading">
            <h3>Comments</h3>
          </div>

          <div className="comment-thread">
            <div className="comment-bubble">
              <strong>{workspace.members[0]?.name ?? "User"}</strong>
              <p>Discuss edits here once commenting is connected.</p>
            </div>
            <div className="comment-bubble comment-bubble--self">
              <strong>You</strong>
              <p>Sidebar reserved for comments and suggestions.</p>
            </div>
          </div>
        </aside>
      </div>

      {createFile.open ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Create file</p>
                <h3>Add a new file to the tree</h3>
              </div>
              <button
                className="ghost-button"
                onClick={onCloseCreateFile}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="stack-form" onSubmit={onCreateFileSubmit}>
              <label>
                <span>File path</span>
                <input
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
              </label>

              <label>
                <span>Kind</span>
                <select
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
              </label>

              <label>
                <span>MIME type</span>
                <input
                  onChange={(event) =>
                    onCreateFileChange({
                      ...createFile,
                      mime: event.target.value,
                    })
                  }
                  placeholder="text/plain"
                  value={createFile.mime}
                />
              </label>

              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "Creating..." : "Create file"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
