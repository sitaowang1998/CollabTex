import type { FormEvent } from "react";
import { ArrowRight, FolderKanban, PlusCircle } from "lucide-react";
import type { ProjectSummary } from "../../../../packages/shared/src/index";
import type { CreateProjectState } from "../app/types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
  onCreateProjectSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <Badge variant="secondary" className="w-fit gap-1">
            <PlusCircle className="h-3.5 w-3.5" />
            Project setup
          </Badge>
          <CardTitle>Create a project</CardTitle>
          <CardDescription>
            Add a project shell first, then enter the workspace to organize
            files and preview the editor layout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onCreateProjectSubmit}>
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                onChange={(event) =>
                  onCreateProjectChange({ name: event.target.value })
                }
                placeholder="Collaborative Thesis"
                required
                value={createProject.name}
              />
            </div>

            <Button className="w-full" disabled={busy} type="submit">
              {busy ? "Creating..." : "Create project"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <Badge variant="secondary" className="w-fit gap-1">
              <FolderKanban className="h-3.5 w-3.5" />
              Project dashboard
            </Badge>
            <CardTitle>Your projects</CardTitle>
            <CardDescription>
              Browse the projects you can access and jump straight into the
              workspace shell.
            </CardDescription>
          </div>
          <Badge variant="outline">{projects.length} total</Badge>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <h3 className="font-serif text-xl font-semibold text-slate-900">
                No projects yet
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Create your first project on the left. Once it exists, you can
                open the workspace and start adding files.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => (
                <button
                  className="group flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  key={project.id}
                  onClick={() => onOpenProject(project.id)}
                  type="button"
                >
                  <div className="space-y-1">
                    <p className="font-serif text-xl font-semibold text-slate-950">
                      {project.name}
                    </p>
                    <Badge variant="secondary">Role: {project.myRole}</Badge>
                  </div>
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition group-hover:text-slate-950">
                    Open workspace
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
