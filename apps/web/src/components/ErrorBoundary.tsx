import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBlock } from "./ui/error-block";

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      error:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="flex min-h-screen items-center justify-center p-4">
          <ErrorBlock
            title="Something went wrong"
            message={this.state.error}
            onRetry={() => window.location.reload()}
            retryLabel="Reload"
          />
        </div>
      );
    }

    return this.props.children;
  }
}
