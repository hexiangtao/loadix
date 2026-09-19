import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ModuleBoundaryProps {
  label: string;
  children: ReactNode;
}

interface ModuleBoundaryState {
  error: Error | null;
}

/** Keeps a broken optional module from taking down the shell and other modules. */
export class ModuleBoundary extends Component<ModuleBoundaryProps, ModuleBoundaryState> {
  state: ModuleBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModuleBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[loadix] ${this.props.label} failed to load`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted" role="alert">
        <p>{this.props.label} failed to load.</p>
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-primary hover:text-primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
