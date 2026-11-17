import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 047 T017 — the four new settings this spec adds each have a descriptor, so the Settings editor
 * renders a control for them.
 *
 * `editor.previews.openTarget` (054 FR-051: now per provider — checked as
 * `editor.previews.providers.markdown.openTarget`), `editor.previews.providers.markdown.gutter`,
 * `editor.previews.providers.markdown.headingJumpMs` and `editor.markdownSectionsOpen`. Every one of
 * them is a RENDERER concern, which core itself does not consume (Principle X).
 *
 * This file used to be `settings-inertness-047.test.ts` and also checked, by matching source text,
 * that production code reads each key. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker; only the descriptor check stays here.
 */

/** The four keys 047 adds, with the behaviour each is supposed to move. */
const NEW_KEYS = [
  {
    // 054 FR-051 — 047's top-level `editor.previews.openTarget` is retired; the setting now lives on
    // each text provider, so the shipped Markdown copy stands in for it here.
    key: 'editor.previews.providers.markdown.openTarget',
    governs:
      'where a STANDALONE preview opens — reuse the last active preview panel in the visible tab, or always open a new one (FR-015a)',
  },
  {
    key: 'editor.previews.providers.markdown.gutter',
    governs: "whether a Markdown preview draws its fold gutter, with each heading's fold arrow (FR-032b)",
  },
  {
    key: 'editor.previews.providers.markdown.headingJumpMs',
    governs: 'how long a jump to a heading in a Markdown preview takes to scroll into view (FR-042d)',
  },
  {
    key: 'editor.markdownSectionsOpen',
    governs:
      "a Markdown document's initial fold state — expanded or collapsed — in the editor and a freshly opened preview alike (FR-039)",
  },
] as const;

describe('047 describes every setting it adds (T017)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all four keys', () => {
    // A key with no descriptor is invisible, a different defect from an inert one, and one
    // `settings-metadata.test.ts` and the completeness gate also own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });
});
