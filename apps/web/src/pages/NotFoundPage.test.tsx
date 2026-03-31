import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";

function renderNotFound() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <div>Home</div> },
      { path: "*", element: <NotFoundPage /> },
    ],
    { initialEntries: ["/nonexistent"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("NotFoundPage", () => {
  it("renders page not found heading", () => {
    renderNotFound();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("renders descriptive message", () => {
    renderNotFound();
    expect(
      screen.getByText(
        "The page you are looking for does not exist or has been moved.",
      ),
    ).toBeInTheDocument();
  });

  it("has a link back to dashboard", () => {
    renderNotFound();
    expect(
      screen.getByRole("button", { name: "Back to Dashboard" }),
    ).toBeInTheDocument();
  });

  it("has a go back button", () => {
    renderNotFound();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });
});
