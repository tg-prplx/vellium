import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Vellium UI render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-primary p-6 text-text-primary">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-bg-secondary p-6 shadow-xl">
          <h1 className="text-lg font-semibold">The interface could not render this screen</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Your data is still intact. You can retry this screen or reload the application.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-tertiary p-3 text-xs text-danger">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-bg-hover"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </section>
      </main>
    );
  }
}
