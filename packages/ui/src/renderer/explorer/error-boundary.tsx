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
    // eslint-disable-next-line no-console
    console.error('File tree error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <div className="explorer__error">File tree failed to render: {this.state.error}</div>;
    }
    return this.props.children;
  }
}
