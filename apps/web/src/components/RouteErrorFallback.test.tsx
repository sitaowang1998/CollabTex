import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { RouteErrorFallback } from "./RouteErrorFallback";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function ThrowingRoute() {
  throw new Error("Route exploded");
  return null;
}

function renderWithRouter(element: React.ReactElement) {
  const router = createMemoryRouter(
    [
      {
        errorElement: <RouteErrorFallback />,
        children: [{ path: "/", element }],
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

function renderWithLoader(loader: () => Promise<unknown>) {
  const router = createMemoryRouter(
    [
      {
        errorElement: <RouteErrorFallback />,
        children: [{ path: "/", loader, element: <div>OK</div> }],
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("RouteErrorFallback", () => {
  it("renders error message when a route throws", () => {
    renderWithRouter(<ThrowingRoute />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Route exploded")).toBeInTheDocument();
  });

  it("shows reload button", () => {
    renderWithRouter(<ThrowingRoute />);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("renders status text for route error responses", async () => {
    renderWithLoader(async () => {
      throw new Response("", { status: 404, statusText: "Not Found" });
    });
    expect(await screen.findByText("Not Found")).toBeInTheDocument();
  });

  it("renders status code when route error response has no statusText", async () => {
    renderWithLoader(async () => {
      throw new Response("", { status: 500 });
    });
    expect(await screen.findByText("500 error")).toBeInTheDocument();
  });

  it("renders generic message for non-Error, non-Response thrown values", async () => {
    renderWithLoader(async () => {
      throw "string error";
    });
    expect(
      await screen.findByText("An unexpected error occurred."),
    ).toBeInTheDocument();
  });

  it("reload button calls window.location.reload", async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    });

    renderWithRouter(<ThrowingRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
