import { useRouteError, isRouteErrorResponse } from "react-router-dom";

export function RouteErrorFallback() {
  const error = useRouteError();
  console.error("Route error:", error);

  let message = "An unexpected error occurred.";
  if (isRouteErrorResponse(error)) {
    message = error.statusText || `${error.status} error`;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
      >
        Reload
      </button>
    </div>
  );
}
