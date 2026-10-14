/**
 * #486 (054 manual test change request, 2026-10-13) — the zoom a step left, as a percentage, in the top-right of
 * whatever zoomed: an editor or preview panel, or a diagram's own box. It fades in, holds for
 * {@link ZOOM_INDICATOR_HOLD_MS}, and fades out slowly (`theme.css`, `.zoom-indicator`), as a browser's does. A
 * further step while it shows updates the figure and restarts the hold, so a run of wheel steps keeps it up.
 *
 * Always mounted, at opacity 0 while idle, so the class change animates both ways. No controls, no pointer, no
 * focus, and hidden from assistive technology: it repeats what the zoom already did, and the panel's own zoom
 * level is on its header menu.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

/** How long the indicator holds after the last step before it starts to fade. */
export const ZOOM_INDICATOR_HOLD_MS = 1000;

export interface ZoomIndicatorProps {
  /** The zoom to show, in percent; rounded. */
  percent: number;
  /** Changes on every zoom step; `0` is "no step yet", which shows nothing. */
  cue: number;
  testId: string;
}

export function ZoomIndicator({ percent, cue, testId }: ZoomIndicatorProps): ReactElement {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (cue === 0) return undefined;
    setShown(true);
    const timer = setTimeout(() => setShown(false), ZOOM_INDICATOR_HOLD_MS);
    return () => clearTimeout(timer);
  }, [cue]);
  return (
    <div className={`zoom-indicator${shown ? ' zoom-indicator--shown' : ''}`} data-testid={testId} aria-hidden="true">
      {cue === 0 ? '' : `${Math.round(percent)}%`}
    </div>
  );
}

/**
 * A cue for {@link ZoomIndicator} that steps whenever `value` changes after the first render — so restoring a
 * zoomed panel shows nothing, and every later change of its zoom does.
 */
export function useChangeCue(value: number): number {
  const last = useRef(value);
  const [cue, setCue] = useState(0);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    setCue((c) => c + 1);
  }, [value]);
  return cue;
}
