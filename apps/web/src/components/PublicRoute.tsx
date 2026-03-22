import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";

export default function PublicRoute() {
  const { state } = useAuth();

  switch (state.status) {
    case "loading":
      return <div>Loading…</div>;
    case "authenticated":
    case "refreshing":
    case "backgroundError":
      return <Navigate to="/" replace />;
    case "unauthenticated":
    case "error":
      return <Outlet />;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
