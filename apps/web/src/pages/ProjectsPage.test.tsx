import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "./ProjectsPage";
import type { CreateProjectState } from "../app/types";
import type { ProjectSummary } from "../../../../packages/shared/src/index";

describe("projects page", () => {
  it("renders an empty state when there are no projects", () => {
    render(
      <ProjectsPage
        busy={false}
        createProject={createProjectState()}
        projects={[]}
        onCreateProjectChange={() => {}}
        onCreateProjectSubmit={(event) => event.preventDefault()}
        onOpenProject={() => {}}
      />,
    );

    expect(screen.getByText("No projects yet")).toBeVisible();
  });

  it("submits the create project form", async () => {
    const user = userEvent.setup();
    const onCreateProjectSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );

    render(
      <ProjectsPage
        busy={false}
        createProject={createProjectState({ name: "Demo project" })}
        projects={[]}
        onCreateProjectChange={() => {}}
        onCreateProjectSubmit={onCreateProjectSubmit}
        onOpenProject={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreateProjectSubmit).toHaveBeenCalledOnce();
  });

  it("opens a project when clicking its card", async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();

    render(
      <ProjectsPage
        busy={false}
        createProject={createProjectState()}
        projects={[createProjectSummary()]}
        onCreateProjectChange={() => {}}
        onCreateProjectSubmit={(event) => event.preventDefault()}
        onOpenProject={onOpenProject}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open workspace/i }));

    expect(onOpenProject).toHaveBeenCalledWith("project-1");
  });
});

function createProjectState(
  overrides: Partial<CreateProjectState> = {},
): CreateProjectState {
  return {
    name: "",
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
