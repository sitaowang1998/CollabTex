import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertBanner } from "./alert-banner";

describe("AlertBanner", () => {
  it("renders error variant by default", () => {
    render(<AlertBanner message="Something failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something failed");
  });

  it("renders warning variant", () => {
    render(<AlertBanner variant="warning" message="Watch out" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Watch out");
  });

  it("renders info variant", () => {
    render(<AlertBanner variant="info" message="FYI" />);
    expect(screen.getByRole("alert")).toHaveTextContent("FYI");
  });

  it("shows retry button when onRetry is provided", async () => {
    const onRetry = vi.fn();
    render(<AlertBanner message="Error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not show retry button when onRetry is not provided", () => {
    render(<AlertBanner message="Error" />);
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("shows dismiss button when onDismiss is provided", async () => {
    const onDismiss = vi.fn();
    render(<AlertBanner message="Error" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("applies custom className", () => {
    render(<AlertBanner message="Error" className="text-xs" />);
    expect(screen.getByRole("alert")).toHaveClass("text-xs");
  });
});
