import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 044 T167 — every one of the nine new preview/navigation preferences has a descriptor, so the
 * Settings editor renders a control for it.
 *
 * `editor.previews.updateDelayMs`, `.maxWaitMs`, `.copyFormat`, `.syncScroll`,
 * `.providers.markdown.enabled`, `.providers.markdown.defaultOpenAction`,
 * `.providers.markdown.loadRemoteImages`, `.providers.markdown.showFrontMatter`, and
 * `editor.navigation.historySize`. Seven shipped first; `syncScroll` (FR-114) and `showFrontMatter`
 * (FR-117) joined in the 2026-09-15 iteration (T186).
 *
 * This file used to be `settings-inertness-044.test.ts` and also checked, by matching source text,
 * that production code reads each key. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker — including the `providers.markdown.*` leaves, which are read through code generic
 * over every provider. Only the descriptor check stays here.
 */

/** The nine keys 044 adds, with the behaviour each is supposed to move. */
const NEW_KEYS = [
  {
    key: 'editor.previews.updateDelayMs',
    governs: 'the trailing debounce before a parented preview shows an edit (FR-060)',
  },
  {
    key: 'editor.previews.maxWaitMs',
    governs:
      'the longest a parented preview goes without showing a change while typing continues (FR-060a)',
  },
  {
    key: 'editor.previews.copyFormat',
    governs: 'what Copy puts on the clipboard from a preview: rich text or plain (FR-035b)',
  },
  {
    key: 'editor.previews.providers.markdown.enabled',
    governs: 'whether Markdown previews are offered at all (FR-001, FR-062, FR-065)',
  },
  {
    key: 'editor.previews.providers.markdown.defaultOpenAction',
    governs:
      'whether opening a Markdown file from File Explorer or Quick Open opens an editor or its preview (FR-050 – FR-052)',
  },
  {
    key: 'editor.previews.providers.markdown.loadRemoteImages',
    governs: 'whether a Markdown preview requests the https images it links, or shows their alt text (FR-092)',
  },
  {
    key: 'editor.previews.syncScroll',
    governs: "whether a preview beside its editor follows the editor's scroll position (FR-113, FR-114)",
  },
  {
    key: 'editor.previews.providers.markdown.showFrontMatter',
    governs: "whether a Markdown preview shows the document's front matter block (FR-117)",
  },
  {
    key: 'editor.navigation.historySize',
    governs: "how many files each editor and preview panel's Back/Forward history holds (FR-108)",
  },
] as const;

describe('044 describes every setting it adds (T167)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all nine keys', () => {
    // A key with no descriptor is invisible, a different defect from an inert one, and one
    // `settings-metadata.test.ts` and the completeness gate also own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });
});
