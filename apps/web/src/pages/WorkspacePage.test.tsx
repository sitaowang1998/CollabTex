import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import type { CreateFileState, WorkspaceState } from "../app/types";
import type {
  ProjectMember,
  ProjectSummary,
} from "../../../../packages/shared/src/index";

describe("workspace page", () => {
  it("disables creating files for read-only users", () => {
    render(
      <WorkspacePage
        busy={false}
        canEditFiles={false}
        createFile={createFileState()}
        projectTitle="Demo Project"
        selectedFileLabel="No file selected"
        workspace={createWorkspaceState()}
        workspaceBusy={false}
        onBackToProjects={() => {}}
        onCloseCreateFile={() => {}}
        onCreateFileChange={() => {}}
        onCreateFileSubmit={(event: FormEvent<HTMLFormElement>) =>
          event.preventDefault()
        }
        onOpenCreateFile={() => {}}
        onRefresh={() => {}}
        onSelectFile={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /new file/i })).toBeDisabled();
    expect(screen.getByText("No files yet.")).toBeVisible();
  });

  it("opens the create file action callback", async () => {
    const user = userEvent.setup();
    const onOpenCreateFile = vi.fn();

    render(
      <WorkspacePage
        busy={false}
        canEditFiles={true}
        createFile={createFileState()}
        projectTitle="Demo Project"
        selectedFileLabel="No file selected"
        workspace={createWorkspaceState()}
        workspaceBusy={false}
        onBackToProjects={() => {}}
        onCloseCreateFile={() => {}}
        onCreateFileChange={() => {}}
        onCreateFileSubmit={(event: FormEvent<HTMLFormElement>) =>
          event.preventDefault()
        }
        onOpenCreateFile={onOpenCreateFile}
        onRefresh={() => {}}
        onSelectFile={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /new file/i }));

    expect(onOpenCreateFile).toHaveBeenCalledOnce();
  });

  it("selects a file from the tree", async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();

    render(
      <WorkspacePage
        busy={false}
        canEditFiles={true}
        createFile={createFileState()}
        projectTitle="Demo Project"
        selectedFileLabel="main.tex"
        workspace={createWorkspaceState({
          tree: [
            {
              type: "file",
              name: "main.tex",
              path: "/main.tex",
              documentId: "document-1",
              documentKind: "text",
              mime: "text/plain",
            },
          ],
        })}
        workspaceBusy={false}
        onBackToProjects={() => {}}
        onCloseCreateFile={() => {}}
        onCreateFileChange={() => {}}
        onCreateFileSubmit={(event: FormEvent<HTMLFormElement>) =>
          event.preventDefault()
        }
        onOpenCreateFile={() => {}}
        onRefresh={() => {}}
        onSelectFile={onSelectFile}
      />,
    );

    await user.click(screen.getByRole("button", { name: "main.tex" }));

    expect(onSelectFile).toHaveBeenCalledWith("/main.tex");
  });

  it("renders the create file dialog when opened", () => {
    render(
      <WorkspacePage
        busy={false}
        canEditFiles={true}
        createFile={createFileState({ open: true })}
        projectTitle="Demo Project"
        selectedFileLabel="No file selected"
        workspace={createWorkspaceState()}
        workspaceBusy={false}
        onBackToProjects={() => {}}
        onCloseCreateFile={() => {}}
        onCreateFileChange={() => {}}
        onCreateFileSubmit={(event: FormEvent<HTMLFormElement>) =>
          event.preventDefault()
        }
        onOpenCreateFile={() => {}}
        onRefresh={() => {}}
        onSelectFile={() => {}}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Add a new file to the tree" }),
    ).toBeVisible();
    expect(screen.getByLabelText("File path")).toBeVisible();
  });
});

function createFileState(
  overrides: Partial<CreateFileState> = {},
): CreateFileState {
  return {
    open: false,
    path: "/main.tex",
    kind: "text",
    mime: "text/plain",
    ...overrides,
  };
}

function createWorkspaceState(
  overrides: Partial<WorkspaceState> = {},
): WorkspaceState {
  return {
    project: createProjectSummary(),
    role: "admin",
    members: [createProjectMember()],
    tree: [],
    selectedPath: null,
    selectedContent: "",
    selectedKind: null,
    ...overrides,
  };
}

function createProjectSummary(
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    id: "project-1",
    name: "Demo Project",
    myRole: "admin",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createProjectMember(
  overrides: Partial<ProjectMember> = {},
): ProjectMember {
  return {
    userId: "user-1",
    email: "alice@example.com",
    name: "Alice",
    role: "admin",
    ...overrides,
  };
}
