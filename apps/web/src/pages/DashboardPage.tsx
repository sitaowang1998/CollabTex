import { useState } from "react";
import type { ProjectSummary } from "@collab-tex/shared";
import { useAuth } from "../contexts/useAuth";
import { api } from "../lib/api";
import { useApiQuery } from "../lib/useApiQuery";
import { Button } from "@/components/ui/button";
import { ErrorBlock } from "@/components/ui/error-block";
import ProjectCard from "@/components/ProjectCard";
import CreateProjectModal from "@/components/CreateProjectModal";

type ProjectListResponse = { projects: ProjectSummary[] };

export default function DashboardPage() {
  const { state, logout } = useAuth();
  const {
    data: projects,
    isLoading,
    error,
    refetch,
    setData: setProjects,
  } = useApiQuery<ProjectSummary[]>({
    queryFn: (signal) =>
      api
        .get<ProjectListResponse>("/projects", { signal })
        .then((d) => d.projects),
    deps: [],
    initialData: [],
  });
  const [showCreateModal, setShowCreateModal] = useState(false);

  function handleCreated(project: ProjectSummary) {
    setProjects((prev) => [project, ...prev]);
    setShowCreateModal(false);
  }

  const userName =
    state.status === "authenticated" ? state.user.name : undefined;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-4 text-3xl font-bold tracking-tight text-center">
        CollabTex
      </h2>
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          {userName && (
            <p className="text-sm text-muted-foreground">{userName}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowCreateModal(true)}>New Project</Button>
          <Button variant="outline" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      {isLoading && (
        <p className="py-12 text-center text-muted-foreground">
          Loading projects…
        </p>
      )}

      {!isLoading && error && (
        <ErrorBlock className="py-12" message={error} onRetry={refetch} />
      )}

      {!isLoading && !error && projects.length === 0 && (
        <div className="py-12 text-center">
          <p className="mb-4 text-muted-foreground">
            You don&apos;t have any projects yet.
          </p>
          <Button onClick={() => setShowCreateModal(true)}>
            Create your first project
          </Button>
        </div>
      )}

      {!isLoading && !error && projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <CreateProjectModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
