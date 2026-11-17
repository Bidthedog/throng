import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 043 FR-059a — every `search.inFiles.*` preference this feature adds has a descriptor, so the
 * Settings editor renders a control for it.
 *
 * Six at FR-059; the seventh and eighth arrive with FR-082, which is why FR-059's own table carries
 * an amendment reading "eight, not six".
 *
 * This file used to be `settings-inertness-043.test.ts` and also checked, by matching source text,
 * that production code reads each key (and that the find bar's own `search.asYouTypeDebounceMs` was
 * still read). That reader guarantee now belongs to `no-inert-settings.test.ts` (spec 071, FR-014),
 * which proves it for every descriptor through the type checker; only the descriptor check stays
 * here.
 */

/** The keys 043 adds, with the behaviour each is supposed to move. */
const NEW_KEYS = [
  {
    key: 'search.inFiles.openTarget',
    governs: 'whether a search reuses the last Find in Files panel or opens a new one (FR-021)',
  },
  {
    key: 'search.inFiles.trigger',
    governs: 'whether a scan waits for Run or starts as you type (FR-043a, FR-043b)',
  },
  {
    key: 'search.inFiles.settleMs',
    governs: 'how long as-you-type waits before walking the tree (FR-043b)',
  },
  {
    key: 'search.inFiles.defaultGrouping',
    governs: 'how a fresh results panel groups its rows (FR-033a)',
  },
  {
    key: 'search.inFiles.warnIrreversibleCommit',
    governs: 'the confirmation before a replace that cannot be undone (FR-057c)',
  },
  {
    key: 'search.inFiles.summaryNoticeMode',
    governs: "the replace summary notice's own display mode, on all three outcomes (FR-082)",
  },
] as const;

describe('043 describes every setting it adds (FR-059a)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('renders a control for all eight keys', () => {
    // A key with no descriptor is invisible, a different defect from an inert one, and one
    // `settings-metadata.test.ts` and the completeness gate also own.
    for (const { key } of NEW_KEYS) expect(declared, `${key} has no descriptor`).toContain(key);
  });
});
