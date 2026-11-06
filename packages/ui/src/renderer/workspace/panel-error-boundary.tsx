import { Component, type ErrorInfo, type ReactNode } from 'react';
import { formatSubject, type NoticeSubject } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { describeError, reportToLog } from '../diagnostics-log.js';

/**
 * PanelErrorBoundary (066 FR-009a, research R5) — the per-panel boundary around every panel body.
 *
 * ══ WHAT "TORN DOWN BY A FAILURE" MEANS ══
 *
 * A panel is torn down when React unmounts its body because a render, an effect or a lifecycle method
 * threw. That is exactly what an error boundary catches, so this is where the fatal record is written.
 * A throw from an EVENT HANDLER does not unmount anything — React keeps the panel mounted — so it never
 * reaches here; it arrives at the window `error` listener (`error-hooks.ts`) and is logged at error.
 *
 * ══ WHAT THE USER SEES ══
 *
 * The shared failure banner (030 US4), in this panel only: siblings keep rendering. It is the one
 * banner every panel type uses, not a crash page of its own. The thrown message is NOT rendered
 * (030 FR-034) — it rides on `detail.systemError`, which reaches the user through Copy details and the
 * log. *Try again* remounts the body; *Clear panel type* is the caller's `onClear`.
 *
 * The subject is the panel's `Project — Tab — Panel`, supplied as structured parts by the caller
 * (`panelSubject(usePanelPlace(id))`) and formatted by `formatSubject` alone, so the log line names the
 * panel the way every notice does.
 */
export const PANEL_CRASH_HEADLINE = 'This panel stopped because of an error.';

interface BoundaryProps {
  panelId: string;
  subject: NoticeSubject;
  /** Back to the panel-type selection screen, panel intact — the banner's Clear panel type. */
  onClear: () => void;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  error: unknown;
}

export class PanelErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The panel's identity is read at the moment of the failure: this is the only record of which panel
    // died, and the layout may have moved on by the time anyone reads the log.
    const stack = info.componentStack;
    reportToLog(
      'fatal',
      'panel',
      `${formatSubject(this.props.subject) || `panel ${this.props.panelId}`} was torn down by a failure: ${describeError(error)}${
        stack ? `\ncomponent stack:${stack}` : ''
      }`,
    );
  }

  /** Remount the body. If it throws again the boundary catches again and says so. */
  private readonly retry = (): Promise<boolean> => {
    this.setState({ failed: false, error: undefined });
    return Promise.resolve(true);
  };

  /** Clear the panel's type, and the failure with it: the next child is the type form, not the crashed body. */
  private readonly clear = (): void => {
    this.setState({ failed: false, error: undefined });
    this.props.onClear();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { error } = this.state;
    return (
      <PanelFailureBanner
        panelId={this.props.panelId}
        headline={PANEL_CRASH_HEADLINE}
        subject={this.props.subject}
        detail={{ systemError: error instanceof Error ? error.message : String(error) }}
        onRetry={this.retry}
        onCancel={this.clear}
      />
    );
  }
}
