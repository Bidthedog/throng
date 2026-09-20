import type { ReactElement } from 'react';
import './link-target-readout.css';

/**
 * 044 FR-118 / 045 FR-167 (round four) — the hovered or focused link's full target, shown at the
 * bottom-left of a status bar, after any persistent content there, and only while the bar is shown.
 *
 * Extracted from the Markdown preview's own status bar (`preview-status-bar.tsx`), which was the
 * first surface to draw one; the editor's status strip and the terminal's status bar now draw the
 * SAME element, so all three read, clip and theme identically (FR-104's kin: one look, drawn once).
 *
 * Renders nothing for `undefined`, `null` or an empty string — the caller decides what "nothing to
 * show" means (no hover, no focus, an inert link) and this component only ever renders a target.
 */
export interface LinkTargetReadoutProps {
  testId: string;
  target: string | null | undefined;
}

export function LinkTargetReadout({ testId, target }: LinkTargetReadoutProps): ReactElement | null {
  if (!target) return null;
  return (
    <span
      className="link-target-readout editor-status-strip__readout preview-status-bar__readout"
      data-testid={testId}
    >
      {target}
    </span>
  );
}
