import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { AuthFormState, AuthMode } from "../app/types";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs
            className="space-y-6"
            onValueChange={(value) => onAuthModeChange(value as AuthMode)}
            value={authMode}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
          </Tabs>

          <form className="space-y-4" onSubmit={onSubmit}>
            {authMode === "register" ? (
              <div className="space-y-2">
                <Label htmlFor="auth-name">Name</Label>
                <Input
                  id="auth-name"
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
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
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
            </div>

            <Button className="w-full" disabled={busy} type="submit">
              {busy
                ? "Submitting..."
                : authMode === "login"
                  ? "Sign in"
                  : "Create account"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
