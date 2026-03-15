import type { CreateProjectState } from "../app/types";
import type { ProjectSummary } from "../../../../packages/shared/src/index";

export function ProjectsPage({
  busy,
  createProject,
  projects,
  onCreateProjectChange,
  onCreateProjectSubmit,
  onOpenProject,
}: {
  busy: boolean;
  createProject: CreateProjectState;
  projects: ProjectSummary[];
  onCreateProjectChange: (nextState: CreateProjectState) => void;
  onCreateProjectSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <section className="dashboard-layout">
      <section className="panel create-project-panel">
        <h2>Create a project</h2>
        <form className="stack-form" onSubmit={onCreateProjectSubmit}>
          <label>
            <span>Project name</span>
            <input
              onChange={(event) =>
                onCreateProjectChange({ name: event.target.value })
              }
              placeholder="Collaborative Thesis"
              required
              value={createProject.name}
            />
          </label>

          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Creating..." : "Create project"}
          </button>
        </form>
      </section>

      <section className="panel project-list-panel">
        <div className="section-heading">
          <h2>Your projects</h2>
          <span className="count-chip">{projects.length}</span>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state">
            <h3>No projects yet</h3>
            <p>
              Create your first project on the left. After that, you can open
              the workspace and start adding files.
            </p>
          </div>
        ) : (
          <div className="project-list">
            {projects.map((project) => (
              <button
                className="project-card"
                key={project.id}
                onClick={() => onOpenProject(project.id)}
                type="button"
              >
                <div>
                  <h3>{project.name}</h3>
                  <p>Role: {project.myRole}</p>
                </div>
                <span>Open workspace</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
