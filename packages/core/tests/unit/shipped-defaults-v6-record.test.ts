import { describe, it, expect } from 'vitest';
import {
  V6_SEARCH_MATCH_COLOURS,
  V6_FIND_IN_FILES_ICON,
  V6_SEARCH_IN_FILES_SETTINGS,
} from '../../src/config/shipped-defaults.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';
import { THRONG_THEME } from '../../src/config/theme.js';
import PRE_REFACTOR from './fixtures/pre-refactor-theme-colours.json';

/**
 * 043 R28 / plan D4 step 1 — the frozen record of what shipped-defaults version **6** wrote to
 * users' disks, captured at the last moment it is still capturable.
 *
 * ══ WHY THIS TEST EXISTS, AND WHY IT CAN ONLY BE WRITTEN NOW ══
 *
 * Version 7 rewrites four defaults on installs that still hold the version-6 value: the three
 * search-match colours in every bundled theme (FR-067), `icons.findInFiles` (FR-065), and two
 * `search.inFiles` leaves (FR-074, FR-075). A guarded rewrite is only as good as the record it
 * guards against, and that record must be a frozen COPY — the reasoning `V4_EXCLUDE_GLOBS` sets
 * out at `shipped-defaults.ts:85-98`: a REFERENCE to the live definitions would compare the current
 * default against itself, match every untouched install forever, and rewrite nothing. A migration
 * that plans nothing is indistinguishable, to every test in this repository, from one that had
 * nothing to do.
 *
 * So this file asserted the copies were faithful **while** the live definitions still held the
 * version-6 values, and each assertion is replaced by its opposite as the corresponding change
 * lands. The successor asserts the frozen record and the live values now DISAGREE, which is what
 * stops a future author quietly re-pointing the guard at whatever the current defaults happen to be.
 *
 * ══ WHERE THAT CONVERSION HAS GOT TO ══
 *
 *   - the three SEARCH-MATCH COLOURS: converted (043 T141 / plan D4 step 4). FR-067's re-derivation
 *     has landed, so `searchMatch` must now differ from the live value in all fifteen themes, and
 *     from the re-seeded fixture too. The other two tokens still agree, because FR-067 left the
 *     accent ray alone — and that narrowness is asserted rather than assumed;
 *   - the two `search.inFiles` LEAVES (FR-074, FR-075): converted (043 T169). `trigger` and
 *     `settleMs` have moved to `asYouType` and 500, so the record must now DISAGREE with the live
 *     defaults on exactly those two and still agree on the other four — both directions asserted,
 *     because "differs somewhere" is the weakened form that would let one of them drift back;
 *   - `icons.findInFiles` (FR-065): converted (043 T182). The glyph has moved, so the record holds
 *     what version 6 wrote and the live theme no longer does.
 */
describe('the frozen version-6 record (R28, D4 step 1)', () => {
  it('carries the three search-match colours for all fifteen bundled themes', () => {
    const names = Object.keys(ALL_DEFAULT_THEMES);
    expect(names).toHaveLength(15);
    expect(Object.keys(V6_SEARCH_MATCH_COLOURS).sort()).toEqual([...names].sort());
    for (const name of names) {
      const v6 = V6_SEARCH_MATCH_COLOURS[name];
      expect(v6, `${name} missing from the v6 record`).toBeDefined();
      for (const token of ['searchMatch', 'searchMatchCurrent', 'searchMatchCurrentBorder'] as const) {
        expect(v6[token], `${name}.${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  /**
   * ══ D4 STEP 4 — THE ASSERTION THAT STOPS THE GUARD BEING QUIETLY UNPLUGGED ══
   *
   * T120 asserted the record AGREED with the live values, because at that moment the live values
   * still were the version-6 values. FR-067's re-derivation has since landed, so the record's whole
   * job is now to hold values the live definitions no longer produce — and the way that job gets
   * silently destroyed is a future author re-pointing `V6_SEARCH_MATCH_COLOURS` at whatever the
   * current defaults or the (re-seeded) fixture happen to be. The guard would then compare each
   * install's on-disk colour against the value the derivation had just produced, match no install
   * ever, rewrite nothing, and pass every test in this repository: a migration that plans nothing is
   * indistinguishable from one that had nothing to do (`shipped-defaults.ts:85-98`, from the theme
   * side). Nothing else in the suite can see that, which is why it is asserted here in as many
   * words rather than left to a comment.
   *
   * It is deliberately "MUST differ", never "may differ". A weakened form passes for a record that
   * has been re-pointed at the live values, which is the exact failure it exists to catch.
   */
  it('DISAGREES with the re-derived values — the record is v6, not a mirror of today (D4 step 4)', () => {
    const agreed: string[] = [];
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      if (V6_SEARCH_MATCH_COLOURS[name].searchMatch === theme.colours.searchMatch) agreed.push(name);
    }
    // All fifteen moved: fourteen by the two-axis derivation, `throng` by hand (plan D5).
    expect(agreed, `still equal to the live derivation: ${agreed.join(', ')}`).toEqual([]);
  });

  it('DISAGREES with the re-seeded non-drift fixture — the two roles stay split (D4 step 4)', () => {
    // The fixture and the record held identical bytes before FR-067, which is what made "just point
    // the guard at the fixture" look reasonable. It records WHAT IS SHIPPED and is re-seeded whenever
    // that changes; the record records what ONE NAMED PAST VERSION shipped and must never move again.
    const fixture = PRE_REFACTOR as Record<string, Record<string, string>>;
    const agreed: string[] = [];
    for (const name of Object.keys(ALL_DEFAULT_THEMES)) {
      if (V6_SEARCH_MATCH_COLOURS[name].searchMatch === fixture[name].searchMatch) agreed.push(name);
    }
    expect(agreed, `record still mirrors the fixture: ${agreed.join(', ')}`).toEqual([]);
  });

  it('the two tokens FR-067 did NOT move still agree — the disagreement is exactly as wide as the change', () => {
    // Stated as an assertion so the test above cannot be satisfied by a wholesale rewrite of the
    // record. FR-067 leaves the accent ray alone: `searchMatchCurrent` is 016 FR-007a's value and
    // `searchMatchCurrentBorder` is derived from it, so both are still byte-identical to version 6.
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const v6 = V6_SEARCH_MATCH_COLOURS[name];
      expect(v6.searchMatchCurrent, `${name}.searchMatchCurrent`).toBe(theme.colours.searchMatchCurrent);
      expect(v6.searchMatchCurrentBorder, `${name}.searchMatchCurrentBorder`).toBe(
        theme.colours.searchMatchCurrentBorder,
      );
    }
  });

  it('still holds the literal colours version 6 wrote to disk', () => {
    // Spot-checked against the values in `pre-refactor-theme-colours.json` as it stood BEFORE the
    // FR-067 re-seed (git history is the other copy). Named literals, because every other assertion
    // in this file is relative to something that can itself move.
    expect(V6_SEARCH_MATCH_COLOURS.throng.searchMatch).toBe('#151e2d');
    expect(V6_SEARCH_MATCH_COLOURS.SUBNET.searchMatch).toBe('#03253e');
    expect(V6_SEARCH_MATCH_COLOURS.Matrix.searchMatch).toBe('#001104');
    expect(V6_SEARCH_MATCH_COLOURS.Light.searchMatch).toBe('#ebf1fd');
  });

  it('carries the `findInFiles` glyph version 6 shipped — which the live theme no longer does', () => {
    // ══ CONVERTED BY 043 T182 (FR-065) ══ The faithful-copy assertion it replaces was right while
    // the live glyph still WAS the version-6 one. It has moved, so the record's job is now to hold
    // what version 6 wrote to disk, and the assertion becomes its opposite — the same conversion the
    // search-match colours and the two `search.inFiles` leaves have already had, for the same
    // reason: re-pointing this constant at the current default would make the upgrade match no
    // install, rewrite nothing, and pass every test here.
    expect(V6_FIND_IN_FILES_ICON).toBe('⌕');
    expect(V6_FIND_IN_FILES_ICON).not.toBe(THRONG_THEME.icons.findInFiles);
  });

  it('carries all six `search.inFiles` leaves version 6 shipped — two of which have since moved', () => {
    /*
     * ══ CONVERTED BY 043 T169 (FR-074, FR-075) — this was the faithful-copy assertion ══
     *
     * It compared the record against the live defaults, because at the moment it was written the
     * live defaults still WERE the version-6 values. T169 moved two of them, so the record's job is
     * now to hold values the live definitions no longer produce, and the assertion becomes its
     * opposite for exactly those two — the same conversion D4 step 4 made for the search-match
     * colours above, and for the same reason: the way this guard gets silently destroyed is a future
     * author re-pointing `V6_SEARCH_IN_FILES_SETTINGS` at whatever the current defaults happen to be,
     * after which the upgrade matches no install, rewrites nothing, and passes every test here.
     *
     * "MUST differ", never "may differ", and named one at a time rather than as an object compare:
     * a `not.toEqual` over all six would be satisfied by ONE leaf differing, which is exactly the
     * weakened form that would let the other move back unnoticed.
     */
    expect(V6_SEARCH_IN_FILES_SETTINGS.trigger).toBe('run');
    expect(V6_SEARCH_IN_FILES_SETTINGS.settleMs).toBe(250);
    expect(DEFAULT_APP_SETTINGS.search.inFiles.trigger).toBe('asYouType');
    expect(DEFAULT_APP_SETTINGS.search.inFiles.settleMs).toBe(500);
    expect(V6_SEARCH_IN_FILES_SETTINGS.trigger).not.toBe(DEFAULT_APP_SETTINGS.search.inFiles.trigger);
    expect(V6_SEARCH_IN_FILES_SETTINGS.settleMs).not.toBe(
      DEFAULT_APP_SETTINGS.search.inFiles.settleMs,
    );

    // The OTHER four are untouched by FR-074/FR-075, and that narrowness is asserted rather than
    // assumed: a leaf drifting out of the record is a leaf the upgrade would stop matching on.
    expect(V6_SEARCH_IN_FILES_SETTINGS.openTarget).toBe(DEFAULT_APP_SETTINGS.search.inFiles.openTarget);
    expect(V6_SEARCH_IN_FILES_SETTINGS.defaultGrouping).toBe(
      DEFAULT_APP_SETTINGS.search.inFiles.defaultGrouping,
    );
    expect(V6_SEARCH_IN_FILES_SETTINGS.rememberGrouping).toBe(
      DEFAULT_APP_SETTINGS.search.inFiles.rememberGrouping,
    );
    expect(V6_SEARCH_IN_FILES_SETTINGS.warnIrreversibleCommit).toBe(
      DEFAULT_APP_SETTINGS.search.inFiles.warnIrreversibleCommit,
    );
  });

  it('is a COPY, not a reference — mutating a live theme cannot move the record', () => {
    // The failure mode `V4_EXCLUDE_GLOBS` records, expressed as an assertion rather than a comment:
    // if the record aliased `ALL_DEFAULT_THEMES`, the guard would track the live value forever.
    const live = ALL_DEFAULT_THEMES.throng.colours;
    expect(V6_SEARCH_MATCH_COLOURS.throng).not.toBe(live);
    expect(Object.isFrozen(V6_SEARCH_MATCH_COLOURS)).toBe(true);
    expect(Object.isFrozen(V6_SEARCH_MATCH_COLOURS.throng)).toBe(true);
    expect(Object.isFrozen(V6_SEARCH_IN_FILES_SETTINGS)).toBe(true);
    expect(V6_SEARCH_IN_FILES_SETTINGS).not.toBe(DEFAULT_APP_SETTINGS.search.inFiles);
  });
});
