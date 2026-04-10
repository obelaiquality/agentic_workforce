import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { reportClientError } from "../lib/errorReporter";

interface Props {
  /** Label shown in the fallback UI (e.g. "Console" or "Settings"). */
  viewName: string;
  children: ReactNode;
  /** Optional custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React error boundary that catches rendering errors in a view subtree,
 * reports them to the backend, and renders a recoverable fallback UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError({
      message: error.message,
      componentStack: info.componentStack ?? undefined,
      source: "error_boundary",
      timestamp: new Date().toISOString(),
      url: window.location.href,
    });
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        role="alert"
        data-testid="error-boundary-fallback"
        className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center"
      >
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-6 py-5 max-w-lg">
          <h2 className="text-sm font-semibold text-rose-300 mb-1">
            {this.props.viewName} encountered an error
          </h2>
          <p className="text-xs text-zinc-400 mb-4 break-words">
            {error.message}
          </p>
          <button
            type="button"
            onClick={this.reset}
            data-testid="error-boundary-retry"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/20"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
