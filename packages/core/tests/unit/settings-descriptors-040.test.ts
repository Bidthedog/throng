import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 040 FR-052 — every setting this feature adds has a descriptor, so the Settings editor renders a
 * control for it.
 *
 * This file used to be `settings-inertness-040.test.ts` and also checked, by matching source text,
 * that production code reads each key and its Editor-section neighbours. That reader guarantee now
 * belongs to `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor
 * through the type checker; only the descriptor check stays here.
 *
 * What the keys actually DO is asserted elsewhere:
 * `packages/ui/tests/component/status-strip-settings.test.ts`, `gutter-compartment.test.ts` and the
 * gutter E2E.
 */

/** The three keys 040 adds, with the surface each is supposed to move. */
const NEW_KEYS = [
  { key: 'editor.statusBar.showCursorPosition', governs: 'the line and column readouts (FR-030)' },
  { key: 'editor.statusBar.showCounts', governs: 'all three counts (FR-031)' },
  { key: 'editor.showGutter', governs: 'the line-number gutter in both editors (FR-040)' },
] as const;

describe('040 describes every setting it adds (FR-052)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all three keys', () => {
    // A key with no descriptor is invisible, a different defect from an inert one, and one
    // `settings-metadata-040.test.ts` and the completeness gate also own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });
});
