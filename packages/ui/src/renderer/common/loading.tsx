import { useEffect, useState, type ReactElement } from 'react';
import './loading.css';

/**
 * True only after `ms` has elapsed. Used to DEFER a spinner so a fast load never
 * flashes it: if the thing being waited on resolves before the delay, the spinner
 * is never shown at all (issue 132 follow-up).
 */
export function useDelayedFlag(ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return on;
}

/** A small themed spinner (draws from the active theme's accent/border). */
export function Spinner({ label = 'Loading' }: { label?: string }): ReactElement {
  return (
    <span className="throng-spinner" role="status" aria-label={label}>
      <span className="throng-spinner__ring" aria-hidden />
    </span>
  );
}

/**
 * A skeleton that fills its (positioned) host panel while the panel's real content
 * streams in — a few shimmering themed lines, so the panel reads as "loading" rather
 * than flashing empty then filling. Give `lines` a set of widths (CSS lengths).
 */
export function PanelSkeleton({
  lines = ['62%', '90%', '48%', '78%', '35%'],
  testId,
}: {
  lines?: string[];
  testId?: string;
}): ReactElement {
  return (
    <div className="throng-panel-skeleton" data-testid={testId} aria-hidden>
      {lines.map((width, i) => (
        <span key={i} className="throng-skeleton throng-panel-skeleton__line" style={{ width }} />
      ))}
    </div>
  );
}
