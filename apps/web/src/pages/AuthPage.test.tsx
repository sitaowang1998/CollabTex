import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthPage } from "./AuthPage";
import type { AuthFormState } from "../app/types";

describe("auth page", () => {
  it("renders the login form by default", () => {
    render(
      <AuthPage
        authForm={createAuthFormState()}
        authMode="login"
        busy={false}
        onAuthFormChange={() => {}}
        onAuthModeChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(screen.getByLabelText("Password")).toBeVisible();
  });

  it("shows the name field in register mode", () => {
    render(
      <AuthPage
        authForm={createAuthFormState()}
        authMode="register"
        busy={false}
        onAuthFormChange={() => {}}
        onAuthModeChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Name")).toBeVisible();
  });

  it("switches modes when clicking the register tab", async () => {
    const user = userEvent.setup();
    const onAuthModeChange = vi.fn();

    render(
      <AuthPage
        authForm={createAuthFormState()}
        authMode="login"
        busy={false}
        onAuthFormChange={() => {}}
        onAuthModeChange={onAuthModeChange}
        onSubmit={(event) => event.preventDefault()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Register" }));

    expect(onAuthModeChange).toHaveBeenCalledWith("register");
  });

  it("submits the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
      event.preventDefault(),
    );

    render(
      <AuthPage
        authForm={createAuthFormState({
          email: "alice@example.com",
          password: "secret",
        })}
        authMode="login"
        busy={false}
        onAuthFormChange={() => {}}
        onAuthModeChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

function createAuthFormState(
  overrides: Partial<AuthFormState> = {},
): AuthFormState {
  return {
    email: "",
    password: "",
    name: "",
    ...overrides,
  };
}
