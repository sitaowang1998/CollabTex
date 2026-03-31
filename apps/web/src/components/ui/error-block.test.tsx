import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBlock } from "./error-block";

describe("ErrorBlock", () => {
  it("renders default title and message", () => {
    render(<ErrorBlock message="Network error" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders custom title", () => {
    render(<ErrorBlock title="Not Found" message="Page missing" />);
    expect(screen.getByText("Not Found")).toBeInTheDocument();
    expect(screen.getByText("Page missing")).toBeInTheDocument();
  });

  it("shows retry button when onRetry is provided", async () => {
    const onRetry = vi.fn();
    render(<ErrorBlock message="Error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("supports custom retry label", () => {
    render(
      <ErrorBlock message="Error" onRetry={() => {}} retryLabel="Reload" />,
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("does not show retry button when onRetry is not provided", () => {
    render(<ErrorBlock message="Error" />);
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("renders additional actions", () => {
    render(<ErrorBlock message="Error" actions={<button>Go Home</button>} />);
    expect(screen.getByRole("button", { name: "Go Home" })).toBeInTheDocument();
  });

  it("renders message with role alert", () => {
    render(<ErrorBlock message="Server error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Server error");
  });
});
