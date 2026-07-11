import { describe, it, expect } from 'vitest';
import { ALL_DEFAULT_THEMES, contrastRatio, resolveColour } from '@throng/core';

/**
 * SC-001 / FR-002: the active-panel indicator must be legible against the adjacent
 * panel background on every bundled theme. Its FOREGROUND treatment
 * (`activePanelBorder`) must clear the WCAG 2.1 AA non-text contrast floor (≥3:1);
 * its dimmed BACKGROUND treatment (`activePanelBorderInactive`) is deliberately
 * de-emphasised and need only stay identifiable at the explicit lower floor
 * (≥1.5:1). Pure-data check across all bundled themes (the throng default + 14).
 */
const ACTIVE_FLOOR = 3.0;
const DIMMED_FLOOR = 1.5;

function ratio(a: string, b: string): number {
  return contrastRatio(a, b);
}

describe('active-panel indicator contrast (SC-001)', () => {
  for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
    const surface = resolveColour(theme, 'surface');
    const active = resolveColour(theme, 'activePanelBorder');
    const dimmed = resolveColour(theme, 'activePanelBorderInactive');

    it(`${name}: foreground indicator clears the AA non-text floor vs the panel surface`, () => {
      expect(ratio(active, surface), `${name} active ${active} vs surface ${surface}`).toBeGreaterThanOrEqual(
        ACTIVE_FLOOR,
      );
    });

    it(`${name}: dimmed indicator stays identifiable but is de-emphasised`, () => {
      const r = ratio(dimmed, surface);
      expect(r, `${name} dimmed ${dimmed} vs surface ${surface}`).toBeGreaterThanOrEqual(DIMMED_FLOOR);
      // The dimmed treatment must be visibly weaker than the foreground one.
      expect(r, `${name} dimmed not weaker than active`).toBeLessThan(ratio(active, surface) + 0.001);
    });
  }
});
