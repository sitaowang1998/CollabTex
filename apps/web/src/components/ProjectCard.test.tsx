import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { ProjectSummary } from "@collab-tex/shared";
import ProjectCard from "./ProjectCard";
import { formatRelativeTime } from "../lib/formatRelativeTime";

function renderCard(project: ProjectSummary) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <ProjectCard project={project} />,
      },
      {
        path: "/projects/:projectId",
        element: <div>Project Page</div>,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const baseProject: ProjectSummary = {
  id: "abc-123",
  name: "My LaTeX Project",
  myRole: "admin",
  updatedAt: new Date().toISOString(),
};

describe("ProjectCard", () => {
  it("renders project name", () => {
    renderCard(baseProject);
    expect(screen.getByText("My LaTeX Project")).toBeInTheDocument();
  });

  it("renders role badge", () => {
    renderCard(baseProject);
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("renders relative timestamp", () => {
    renderCard(baseProject);
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("navigates to project page on click", async () => {
    const user = userEvent.setup();
    renderCard(baseProject);
    await user.click(screen.getByText("My LaTeX Project"));
    expect(screen.getByText("Project Page")).toBeInTheDocument();
  });

  it("shows different role badges", () => {
    renderCard({ ...baseProject, myRole: "reader" });
    expect(screen.getByText("reader")).toBeInTheDocument();
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const threeHoursAgo = new Date(
      Date.now() - 3 * 60 * 60 * 1000,
    ).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const twoDaysAgo = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });
});
