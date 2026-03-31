import { useRouteError, isRouteErrorResponse } from "react-router-dom";
import { ErrorBlock, type ErrorBlockIcon } from "./ui/error-block";

export function RouteErrorFallback() {
  const error = useRouteError();
  console.error("Route error:", error);

  let message = "An unexpected error occurred.";
  let icon: ErrorBlockIcon = "generic";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      icon = "not-found";
      message = "The page you are looking for does not exist.";
    } else if (error.status === 403) {
      icon = "forbidden";
      message = "You don't have permission to access this page.";
    } else {
      message = error.statusText || `${error.status} error`;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <ErrorBlock
        icon={icon}
        title="Something went wrong"
        message={message}
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />
    </div>
  );
}
