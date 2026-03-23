import { useState, useEffect } from "react";
import type { ProjectSummary } from "@collab-tex/shared";
import { useAuth } from "../contexts/useAuth";
import { api, ApiError } from "../lib/api";
import { Button } from "@/components/ui/button";
import ProjectCard from "@/components/ProjectCard";
import CreateProjectModal from "@/components/CreateProjectModal";

type ProjectListResponse = { projects: ProjectSummary[] };

export default function DashboardPage() {
  const { state, logout } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchProjects() {
      setIsLoading(true);
      setError("");
      try {
        const data = await api.get<ProjectListResponse>("/projects", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setProjects(data.projects);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          console.error("Failed to load projects:", err);
          setError("Failed to load projects");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchProjects();
    return () => controller.abort();
  }, [retryKey]);

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
        <div className="py-12 text-center">
          <p className="mb-4 text-destructive" role="alert">
            {error}
          </p>
          <Button variant="outline" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
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
