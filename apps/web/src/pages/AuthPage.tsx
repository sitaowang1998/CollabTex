import type { AuthFormState, AuthMode } from "../app/types";

export function AuthPage({
  authForm,
  authMode,
  busy,
  onAuthModeChange,
  onAuthFormChange,
  onSubmit,
}: {
  authForm: AuthFormState;
  authMode: AuthMode;
  busy: boolean;
  onAuthModeChange: (mode: AuthMode) => void;
  onAuthFormChange: (nextForm: AuthFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="auth-layout">
      <section className="panel auth-panel">
        <div className="tab-row">
          <button
            className={authMode === "login" ? "tab active" : "tab"}
            onClick={() => onAuthModeChange("login")}
            type="button"
          >
            Login
          </button>
          <button
            className={authMode === "register" ? "tab active" : "tab"}
            onClick={() => onAuthModeChange("register")}
            type="button"
          >
            Register
          </button>
        </div>

        <form className="stack-form" onSubmit={onSubmit}>
          {authMode === "register" ? (
            <label>
              <span>Name</span>
              <input
                onChange={(event) =>
                  onAuthFormChange({
                    ...authForm,
                    name: event.target.value,
                  })
                }
                placeholder="Your name"
                required
                value={authForm.name}
              />
            </label>
          ) : null}

          <label>
            <span>Email</span>
            <input
              onChange={(event) =>
                onAuthFormChange({
                  ...authForm,
                  email: event.target.value,
                })
              }
              placeholder="name@mail.utoronto.ca"
              required
              type="email"
              value={authForm.email}
            />
          </label>

          <label>
            <span>Password</span>
            <input
              onChange={(event) =>
                onAuthFormChange({
                  ...authForm,
                  password: event.target.value,
                })
              }
              placeholder="Enter your password"
              required
              type="password"
              value={authForm.password}
            />
          </label>

          <button className="primary-button" disabled={busy} type="submit">
            {busy
              ? "Submitting..."
              : authMode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </section>
    </section>
  );
}
