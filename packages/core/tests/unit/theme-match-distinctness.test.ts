import { describe, it, expect } from 'vitest';
import {
  MATCH_SURFACE_PAIRS,
  MATCH_DISTINCTNESS_THRESHOLD,
  CLOSEST_MATCH_SURFACE_DELTA,
  measureMatchDistinctness,
  matchDistinctnessFailures,
  closestMatchSurfacePair,
  assertMatchDistinctness,
} from '../../src/config/theme-quality.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 043 FR-067 (research R24) — an ordinary search match, the current search match and the surface
 * behind them must be mutually distinguishable in every bundled theme.
 *
 * ══ WHAT WAS MISSING, AND WHY THIS IS A SEPARATE FILE ══
 *
 * `theme-quality.ts` measured exactly one thing about these two tokens: that SYNTAX-COLOURED CODE
 * stays readable on top of each of them (`SYNTAX_ON_MATCH`, 016 FR-007a). Nothing measured the two
 * fills against EACH OTHER, or either against the page — so a theme could paint hard-select and
 * soft-select the same colour and pass every gate in the build. The derivation then did precisely
 * that on the dark themes: an ordinary match was `strongest * 0.45` of a quantity that is itself
 * small when the accent ray is short.
 *
 * The gate runs over **`ALL_DEFAULT_THEMES`, never `DEFAULT_THEMES`** (plan D5). Fourteen themes are
 * derived through `makeTheme` and are therefore *maintained* by the derivation; `throng` is
 * hand-authored (`theme.ts`) and is not. A gate scoped to the derived fourteen would pass forever
 * while the built-in default drifted — which is the one theme every user sees first.
 */
describe('search-match mutual distinctness (FR-067, R24)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);

  it('measures exactly the three pairs R24 names, per theme', () => {
    expect(MATCH_SURFACE_PAIRS.map(([a, b]) => `${a}|${b}`)).toEqual([
      'searchMatch|searchMatchCurrent',
      'searchMatch|editorBg',
      'searchMatchCurrent|editorBg',
    ]);
    for (const theme of themes) {
      expect(measureMatchDistinctness(theme), theme.name).toHaveLength(3);
    }
  });

  it('no bundled theme renders the two matches, or either and its surface, indistinguishably', () => {
    // NAMES the offenders rather than reporting a bare count: the whole reason this rule exists is
    // that a maintainer could see the collapse and no test could say which themes caused it.
    const offenders = themes.flatMap((t) =>
      matchDistinctnessFailures(t).map(
        (f) => `${t.name}: ${f.a} vs ${f.b} = ΔE00 ${f.delta.toFixed(2)} (needs ${f.min})`,
      ),
    );
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('all fifteen are covered — the hand-authored `throng` included (D5)', () => {
    expect(Object.keys(ALL_DEFAULT_THEMES)).toHaveLength(15);
    expect(themes.map((t) => t.name)).toContain('throng');
    expect(() => assertMatchDistinctness(themes)).not.toThrow();
  });

  it('the threshold sits below the measured closest pair, with the headroom recorded', () => {
    const { theme, a, b, delta } = closestMatchSurfacePair(themes);
    expect(delta, `closest match-surface pair: ${theme} ${a} vs ${b} = ${delta}`).toBeGreaterThan(
      MATCH_DISTINCTNESS_THRESHOLD,
    );
    // M1: the constant follows the measurement, never the other way round (`theme-quality.ts`).
    expect(CLOSEST_MATCH_SURFACE_DELTA).toBeCloseTo(delta, 2);
  });

  it('the threshold is above the CIEDE2000 just-noticeable difference (~2.3)', () => {
    // A floor chosen to be whatever the themes happen to pass is a ratchet, not a rule. This is the
    // half of the calibration that does NOT come from the themes: below ~2.3 ΔE00 two surface
    // colours are, by the standard, the same colour to a viewer.
    expect(MATCH_DISTINCTNESS_THRESHOLD).toBeGreaterThanOrEqual(2.3);
  });

  it('rejects a theme that paints both matches the same colour', () => {
    const collapsed: Theme = {
      ...ALL_DEFAULT_THEMES.throng,
      name: 'Collapsed',
      colours: {
        ...ALL_DEFAULT_THEMES.throng.colours,
        searchMatch: ALL_DEFAULT_THEMES.throng.colours.searchMatchCurrent,
      },
    };
    expect(() => assertMatchDistinctness([collapsed])).toThrow(/Collapsed/);
    expect(matchDistinctnessFailures(collapsed).map((f) => `${f.a}|${f.b}`)).toContain(
      'searchMatch|searchMatchCurrent',
    );
  });

  it('rejects a theme whose ordinary match is a whisper away from its page', () => {
    // The shape SUBNET shipped: an ordinary match ten units of green off the page and its blue
    // going the wrong way. Reproduced here as a fixture so the rule is proven to bite on it even
    // once the bundled themes have been re-derived past it.
    const whisper: Theme = {
      ...ALL_DEFAULT_THEMES.SUBNET,
      name: 'Whisper',
      colours: {
        ...ALL_DEFAULT_THEMES.SUBNET.colours,
        editorBg: '#001b40',
        searchMatch: '#001d42',
      },
    };
    expect(() => assertMatchDistinctness([whisper])).toThrow(/Whisper/);
  });
});
