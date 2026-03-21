import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";

export default function ProtectedRoute() {
  const { state, retryAuth, logout } = useAuth();
  const location = useLocation();

  switch (state.status) {
    case "loading":
      return <div>Loading…</div>;
    case "error":
      return (
        <div>
          <p>Authentication failed: {state.error}</p>
          <button onClick={() => retryAuth()}>Retry</button>
          <button onClick={() => logout()}>Go to Login</button>
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
          <div
            role="alert"
            style={{
              padding: "8px 16px",
              background: "#fef3c7",
              color: "#92400e",
            }}
          >
            <span>Something went wrong: {state.error}</span>{" "}
            <button onClick={() => retryAuth()}>Retry</button>
          </div>
          <Outlet />
        </>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
