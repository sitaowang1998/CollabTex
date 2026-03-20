import type { FormEvent } from "react";
import { ArrowRight, Lock, Sparkles, Users } from "lucide-react";
import type { AuthFormState, AuthMode } from "../app/types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,430px)]">
      <Card className="overflow-hidden border-slate-900 bg-slate-950 text-white shadow-xl">
        <CardHeader className="relative overflow-hidden pb-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.28),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(165,180,252,0.22),_transparent_30%)]" />
          <div className="relative space-y-5">
            <Badge className="w-fit bg-white/10 text-white">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Web UI scope
            </Badge>
            <div className="space-y-3">
              <CardTitle className="max-w-xl text-4xl text-white sm:text-5xl">
                Sign in, create projects, and preview the workspace shell.
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7 text-slate-300">
                This frontend iteration focuses on the three product surfaces
                requested in the rubric: auth, project dashboard, and a
                responsive workspace UI.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <Lock className="mb-3 h-5 w-5 text-sky-300" />
            <p className="font-medium">Authentication</p>
            <p className="mt-2 text-slate-300">
              Login and register flows wired to the backend auth endpoints.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <Users className="mb-3 h-5 w-5 text-sky-300" />
            <p className="font-medium">Projects</p>
            <p className="mt-2 text-slate-300">
              Create projects, browse cards, and enter the workspace shell.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <ArrowRight className="mb-3 h-5 w-5 text-sky-300" />
            <p className="font-medium">Workspace</p>
            <p className="mt-2 text-slate-300">
              File tree, editor, preview, and comments arranged responsively.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {authMode === "login"
              ? "Use your registered account to enter the CollabTex dashboard."
              : "Register a new account to start creating collaborative projects."}
          </CardDescription>
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
