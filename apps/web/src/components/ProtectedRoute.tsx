import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import { ErrorBlock } from "./ui/error-block";
import { AlertBanner } from "./ui/alert-banner";
import { Button } from "./ui/button";

export default function ProtectedRoute() {
  const { state, retryAuth, logout } = useAuth();
  const location = useLocation();

  switch (state.status) {
    case "loading":
      return (
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      );
    case "error":
      return (
        <div className="flex min-h-screen items-center justify-center p-4">
          <ErrorBlock
            icon="auth"
            title="Authentication failed"
            message={state.error}
            onRetry={() => retryAuth()}
            actions={
              <Button variant="outline" onClick={() => logout()}>
                Go to Login
              </Button>
            }
          />
        </div>
      );
    case "unauthenticated":
      return <Navigate to="/login" replace state={{ from: location }} />;
    case "authenticated":
      return <Outlet />;
    case "refreshing":
      return <Outlet />;
    case "backgroundError":
      return (
        <>
          <AlertBanner
            variant="warning"
            message={`Something went wrong: ${state.error}`}
            onRetry={() => retryAuth()}
          />
          <Outlet />
        </>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
