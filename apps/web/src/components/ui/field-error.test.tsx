import { render, screen } from "@testing-library/react";
import { FieldError } from "./field-error";

describe("FieldError", () => {
  it("renders nothing when message is undefined", () => {
    const { container } = render(<FieldError />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when message is empty string", () => {
    const { container } = render(<FieldError message="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders error message", () => {
    render(<FieldError message="Email is required" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Email is required");
  });

  it("applies id for aria-describedby linking", () => {
    render(<FieldError message="Required" id="email-error" />);
    expect(screen.getByRole("alert")).toHaveAttribute("id", "email-error");
  });
});
