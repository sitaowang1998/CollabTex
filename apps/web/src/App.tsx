import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LayoutDashboard, LogOut, Sparkles } from "lucide-react";
import type {
  AuthResponse,
  AuthUser,
  FileTreeNode,
  ProjectDetailsResponse,
  ProjectDocumentContentResponse,
  ProjectMemberListResponse,
  ProjectSummary,
} from "../../../packages/shared/src/index";
import {
  TOKEN_STORAGE_KEY,
  type AppScreen,
  type AuthFormState,
  type AuthMode,
  type CreateFileState,
  type CreateProjectState,
  type WorkspaceState,
} from "./app/types";
import { Banner } from "./components/Banner";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { apiFetch, getErrorMessage } from "./lib/api";
import { AuthPage } from "./pages/AuthPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { WorkspacePage } from "./pages/WorkspacePage";

function App() {
  const [token, setToken] = useState<string | null>(() =>
    window.localStorage.getItem(TOKEN_STORAGE_KEY),
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [screen, setScreen] = useState<AppScreen>(
    token ? { name: "projects" } : { name: "auth" },
  );
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState<AuthFormState>({
    email: "",
    password: "",
    name: "",
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [createProject, setCreateProject] = useState<CreateProjectState>({
    name: "",
  });
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    project: null,
    role: null,
    members: [],
    tree: [],
    selectedPath: null,
    selectedContent: "",
    selectedKind: null,
  });
  const [createFile, setCreateFile] = useState<CreateFileState>({
    open: false,
    path: "/main.tex",
    kind: "text",
    mime: "text/plain",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEditFiles =
    workspace.role === "admin" || workspace.role === "editor";

  const selectedFileLabel = workspace.selectedPath
    ? workspace.selectedPath.split("/").filter(Boolean).join(" / ")
    : "No file selected";

  const projectTitle = useMemo(() => {
    if (screen.name !== "workspace") {
      return "";
    }

    return workspace.project?.name ?? "Workspace";
  }, [screen, workspace.project?.name]);

  useEffect(() => {
    void bootstrapApp();
    // We only need to run the initial session check once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrapApp() {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const me = await apiFetch<{ user: AuthUser }>("/api/auth/me", { token });
      setUser(me.user);
      const nextProjects = await loadProjects(token);

      if (screen.name === "workspace") {
        await openWorkspace(screen.projectId, token, nextProjects);
      }
    } catch (requestError) {
      clearSession();
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function loadProjects(authToken: string) {
    const response = await apiFetch<{ projects: ProjectSummary[] }>(
      "/api/projects",
      {
        token: authToken,
      },
    );
    setProjects(response.projects);
    return response.projects;
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const endpoint =
        authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        authMode === "login"
          ? {
              email: authForm.email.trim(),
              password: authForm.password,
            }
          : {
              email: authForm.email.trim(),
              password: authForm.password,
              name: authForm.name.trim(),
            };

      const response = await apiFetch<AuthResponse>(endpoint, {
        method: "POST",
        body: payload,
      });

      window.localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
      await loadProjects(response.token);
      setScreen({ name: "projects" });
      setAuthForm({ email: "", password: "", name: "" });
      setNotice(
        authMode === "login"
          ? "Login successful."
          : "Account created. You can start your first project now.",
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await apiFetch("/api/projects", {
        method: "POST",
        token,
        body: {
          name: createProject.name.trim(),
        },
      });

      const nextProjects = await loadProjects(token);
      setCreateProject({ name: "" });
      setNotice("Project created.");

      if (nextProjects.length > 0) {
        const newestProject = [...nextProjects].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )[0];
        await openWorkspace(newestProject.id, token, nextProjects);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function openWorkspace(
    projectId: string,
    authToken: string = token ?? "",
    knownProjects: ProjectSummary[] = projects,
  ) {
    if (!authToken) {
      return;
    }

    setWorkspaceBusy(true);
    setError(null);
    setNotice(null);

    try {
      const [details, members, treeResponse] = await Promise.all([
        apiFetch<ProjectDetailsResponse>(`/api/projects/${projectId}`, {
          token: authToken,
        }),
        apiFetch<ProjectMemberListResponse>(
          `/api/projects/${projectId}/members`,
          {
            token: authToken,
          },
        ),
        apiFetch<{ nodes: FileTreeNode[] }>(`/api/projects/${projectId}/tree`, {
          token: authToken,
        }),
      ]);

      const matchedProject = knownProjects.find(
        (project) => project.id === projectId,
      ) ?? {
        ...details.project,
        myRole: details.myRole,
      };

      setWorkspace({
        project: matchedProject,
        role: details.myRole,
        members: members.members,
        tree: treeResponse.nodes,
        selectedPath: null,
        selectedContent: "",
        selectedKind: null,
      });
      setScreen({ name: "workspace", projectId });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleSelectFile(path: string) {
    if (!token || screen.name !== "workspace") {
      return;
    }

    setWorkspaceBusy(true);
    setError(null);

    try {
      const response = await apiFetch<ProjectDocumentContentResponse>(
        `/api/projects/${screen.projectId}/files/content?path=${encodeURIComponent(path)}`,
        {
          token,
        },
      );

      setWorkspace((currentWorkspace) => ({
        ...currentWorkspace,
        selectedPath: path,
        selectedContent:
          response.document.kind === "text"
            ? (response.content ?? "")
            : "Binary file selected. Text preview is not available.",
        selectedKind: response.document.kind,
      }));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleCreateFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || screen.name !== "workspace") {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const body: {
        path: string;
        kind: CreateFileState["kind"];
        mime?: string;
      } = {
        path: createFile.path.trim(),
        kind: createFile.kind,
      };

      if (createFile.kind === "binary") {
        const trimmedMime = createFile.mime.trim();
        if (trimmedMime) {
          body.mime = trimmedMime;
        }
      }

      await apiFetch(`/api/projects/${screen.projectId}/files`, {
        method: "POST",
        token,
        body,
      });

      await openWorkspace(screen.projectId, token);
      setCreateFile({
        open: false,
        path: "/main.tex",
        kind: "text",
        mime: "text/plain",
      });
      setNotice(
        "File created. Tip: folders are created automatically from the file path, for example /sections/intro.tex.",
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
    setProjects([]);
    setWorkspace({
      project: null,
      role: null,
      members: [],
      tree: [],
      selectedPath: null,
      selectedContent: "",
      selectedKind: null,
    });
    setScreen({ name: "auth" });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-lg">
          <div className="mb-4 flex items-center gap-2">
            <Badge variant="secondary">CollabTex</Badge>
            <Badge variant="outline">Loading</Badge>
          </div>
          <h1 className="font-serif text-3xl font-semibold text-slate-950">
            Loading workspace...
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            We are checking whether you already have a signed-in session.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>CollabTex</Badge>
                <Badge variant="secondary">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  React + Tailwind + shadcn/ui
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  Collaborative LaTeX workspace shell
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                  Auth, projects, and workspace UI for CollabTex. This branch
                  focuses on a responsive web interface without backend socket
                  changes.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Badge variant="outline" className="gap-1">
                <LayoutDashboard className="h-3.5 w-3.5" />
                {screen.name === "auth"
                  ? "Auth"
                  : screen.name === "projects"
                    ? "Projects"
                    : "Workspace"}
              </Badge>
              {user ? (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                    <p className="text-sm font-medium text-slate-900">
                      {user.name}
                    </p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={clearSession}
                    type="button"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {error ? <Banner tone="error" message={error} /> : null}
        {notice ? <Banner tone="success" message={notice} /> : null}

        {screen.name === "auth" ? (
          <AuthPage
            authForm={authForm}
            authMode={authMode}
            busy={busy}
            onAuthFormChange={setAuthForm}
            onAuthModeChange={setAuthMode}
            onSubmit={handleAuthSubmit}
          />
        ) : null}

        {screen.name === "projects" ? (
          <ProjectsPage
            busy={busy}
            createProject={createProject}
            projects={projects}
            onCreateProjectChange={setCreateProject}
            onCreateProjectSubmit={handleCreateProject}
            onOpenProject={(projectId) => void openWorkspace(projectId)}
          />
        ) : null}

        {screen.name === "workspace" ? (
          <WorkspacePage
            busy={busy}
            canEditFiles={canEditFiles}
            createFile={createFile}
            projectTitle={projectTitle}
            selectedFileLabel={selectedFileLabel}
            workspace={workspace}
            workspaceBusy={workspaceBusy}
            onBackToProjects={() => setScreen({ name: "projects" })}
            onCloseCreateFile={() =>
              setCreateFile((currentState) => ({
                ...currentState,
                open: false,
              }))
            }
            onCreateFileChange={setCreateFile}
            onCreateFileSubmit={handleCreateFile}
            onOpenCreateFile={() =>
              setCreateFile((currentState) => ({
                ...currentState,
                open: true,
              }))
            }
            onRefresh={() => void openWorkspace(screen.projectId)}
            onSelectFile={(path) => void handleSelectFile(path)}
          />
        ) : null}
      </div>
    </main>
  );
}

export default App;
