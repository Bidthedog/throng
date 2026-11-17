import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 049 T036 — the one setting this spec adds, `editor.highlightOccurrences`, has a descriptor, so the
 * Settings editor renders a control for it. It governs whether a selection tints its other
 * occurrences in editors and Markdown previews (FR-019).
 *
 * This file used to be `settings-inertness-049.test.ts` and also checked, by matching source text,
 * that production code reads the key. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker; only the descriptor check stays here.
 */

const KEY = 'editor.highlightOccurrences';

describe('049 describes the setting it adds (T036)', () => {
  it('renders a control for the key', () => {
    expect(SETTINGS_METADATA.map((d) => d.key)).toContain(KEY);
  });
});
