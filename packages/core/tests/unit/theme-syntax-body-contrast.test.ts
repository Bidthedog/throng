/**
 * REGRESSION (issue #83): syntax colours are never contrast-checked against the editor body.
 *
 * The requirement this file encodes is not "add ten lines to CONTRAST_PAIRINGS". It is:
 *
 *   1. Every colour the editor paints code with is MEASURED against the background it is painted
 *      on. `editorBg` is that background for the overwhelming majority of a source file; the
 *      existing pairings measure the syntax hues only against the two SEARCH-MATCH surfaces, which
 *      is the background for a handful of characters, occasionally.
 *
 *   2. The pairing list is DERIVED from the token set rather than hand-listed. This is the part
 *      that actually prevents recurrence: a hand list is precisely how these ten tokens were
 *      missed when 016 introduced them, so a test that hard-codes the same ten names would be
 *      re-writing the bug in the test suite. Every assertion below therefore reads the syntax
 *      token set out of the canonical theme registry (`THRONG_THEME.colours` — the always-complete
 *      theme every other theme falls back to) and demands that the guard cover whatever it finds,
 *      including tokens that do not exist yet.
 *
 * NOTE ON THE ISSUE'S PREMISE: the bundled themes currently PASS the legibility measurement (see
 * the third block) — `makeTheme` happens to lift each seed to 6:1 against `editorBg` on its way in.
 * That is a derivation-time accident, not a gate: nothing measures it, nothing fails a build over
 * it, and a hand-authored theme (which `throng` itself is) bypasses the lift entirely. The gap is
 * real even though the symptom is currently absent.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRINGS,
  SYNTAX_BODY_MIN,
  SYNTAX_TOKENS,
  WCAG_AA_BODY,
  contrastRatio,
  measureContrast,
} from '../../src/config/theme-quality.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME, type Theme } from '../../src/config/theme.js';

const THEMES: readonly Theme[] = Object.values(ALL_DEFAULT_THEMES);

/**
 * The syntax token set, DERIVED from the canonical registry rather than restated here.
 *
 * This is deliberately NOT `SYNTAX_TOKENS` — that constant is itself a hand-list, so trusting it
 * would leave the same escape hatch one level down: a future `syntaxDecorator` added to the themes
 * and forgotten in `SYNTAX_TOKENS` would be invisible to every assertion below.
 */
const syntaxTokensFromRegistry = (): readonly string[] =>
  Object.keys(THRONG_THEME.colours)
    .filter((token) => token.startsWith('syntax'))
    .sort();

describe('every syntax colour is measured against the editor body (issue #83)', () => {
  it('CONTRAST_PAIRINGS carries an editorBg pairing for every syntax token in the registry', () => {
    const measured = new Set(
      CONTRAST_PAIRINGS.filter((p) => p.bg === 'editorBg').map((p) => p.fg),
    );
    const unmeasured = syntaxTokensFromRegistry().filter((t) => !measured.has(t));
    expect(unmeasured, `syntax tokens never measured against editorBg: ${unmeasured.join(', ')}`).toEqual(
      [],
    );
  });

  it('measures each of them at the body-text threshold, not a relaxed UI one', () => {
    for (const token of syntaxTokensFromRegistry()) {
      const pairing = CONTRAST_PAIRINGS.find((p) => p.fg === token && p.bg === 'editorBg');
      expect(pairing, `no editorBg pairing for ${token}`).toBeDefined();
      expect(pairing?.min, `${token} on editorBg is gated below body text`).toBe(SYNTAX_BODY_MIN);
      expect(SYNTAX_BODY_MIN).toBeGreaterThanOrEqual(WCAG_AA_BODY);
    }
  });

  it('measureContrast() reports an editorBg result for every syntax token of a real theme', () => {
    const results = measureContrast(ALL_DEFAULT_THEMES.Light);
    const seen = new Set(results.filter((r) => r.bg === 'editorBg').map((r) => r.fg));
    const missing = syntaxTokensFromRegistry().filter((t) => !seen.has(t));
    expect(missing, `Light: measureContrast() never looks at ${missing.join(', ')} on editorBg`).toEqual(
      [],
    );
  });
});

describe('the pairing list is derived, so a future syntax token cannot escape (issue #83)', () => {
  it('covers a syntax token that does not exist yet', () => {
    // The bug's actual mechanism, reproduced: a token is added to the theme and the hand-written
    // pairing list simply does not know about it. A DERIVED list would pick it up for free.
    const invented = 'syntaxDecorator';
    const future: Theme = {
      ...THRONG_THEME,
      name: 'future',
      colours: {
        ...THRONG_THEME.colours,
        // Deliberately illegible: near-identical to throng's editorBg (#0c0f16).
        [invented]: '#0d1017',
      },
    };

    const results = measureContrast(future);
    const covered = results.some((r) => r.fg === invented && r.bg === 'editorBg');
    expect(
      covered,
      `${invented} paints code on editorBg at ${contrastRatio(
        future.colours[invented],
        future.colours.editorBg,
      ).toFixed(2)}:1 and no pairing measures it`,
    ).toBe(true);
    expect(results.find((r) => r.fg === invented && r.bg === 'editorBg')?.pass).toBe(false);
  });

  it('SYNTAX_TOKENS agrees with the registry (a hand-list that has drifted is the same bug)', () => {
    expect([...SYNTAX_TOKENS].sort()).toEqual([...syntaxTokensFromRegistry()]);
  });
});

describe('bundled themes render code legibly on their own editor background (issue #83)', () => {
  it.each(THEMES.map((t) => [t.name, t] as const))(
    '%s: every syntax token clears WCAG AA body on editorBg',
    (_name, theme) => {
      const bg = theme.colours.editorBg;
      const failures = syntaxTokensFromRegistry()
        .map((token) => ({ token, fg: theme.colours[token] }))
        .filter((x) => x.fg !== undefined)
        .map((x) => ({ ...x, ratio: contrastRatio(x.fg, bg) }))
        .filter((x) => x.ratio < WCAG_AA_BODY)
        .map((x) => `${x.token} ${x.fg} on ${bg} = ${x.ratio.toFixed(2)}:1`);
      expect(failures, `illegible syntax colours: ${failures.join('; ')}`).toEqual([]);
    },
  );
});
