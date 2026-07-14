/**
 * TreeErrorBoundary (004) — keeps a file-tree rendering error from taking down
 * the whole renderer (FR-025: non-fatal). Shows a small inline message instead.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export class TreeErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('File tree error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      // 018: its OWN class. This is a CRASH FALLBACK — it replaces a subtree that threw, rather than
      // reporting a failure over one that still works. It is not the notice model's job, and it was
      // only ever borrowing the error strip's styling.
      return <div className="explorer__crash">File tree failed to render: {this.state.error}</div>;
    }
    return this.props.children;
  }
}
