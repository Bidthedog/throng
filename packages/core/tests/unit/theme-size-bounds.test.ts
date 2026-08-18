/**
 * The bounds and the attribute sets the theme editor offers (018, 021).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/theme-sizes-and-notices.e2e.ts` (034 FR-045) — the two tests
 * in that file that read no style and measure nothing:
 *
 *   "the base font size cannot be set large enough to destroy the application"
 *   "the TERMINAL offers only the two attributes xterm can honour"
 *
 * Both launched the app and opened the preferences window as a SECOND window in order to read
 * `max` off a rendered slider and count which `control-typography.terminal.*` test ids existed. The
 * Themes form is generated from `buildThemeMetadata`, so both are claims about a descriptor table.
 *
 * ══ THIS IS NEW COVERAGE, NOT A RELOCATION ══
 *
 * `theme-metadata.test.ts` asserts that `fonts.baseSizePx` IS a slider. Nothing asserted its
 * CEILING, and nothing anywhere asserted which attributes the terminal role offers. Both claims
 * existed only end-to-end, which is why they are written here before that file is trimmed rather
 * than after.
 */
import { describe, expect, it } from 'vitest';
/*
 * `BASE_FONT_MAX_PX` and `roleSizeMax` are imported from the module rather than the package index,
 * because the index does not re-export them — which is itself worth knowing: they are internal to the
 * metadata builder, and the only way anything outside `@throng/core` sees these bounds is through the
 * descriptors they produce. That is exactly why the descriptor assertions below exist alongside the
 * constant ones.
 */
import {
  BASE_FONT_MAX_PX,
  descriptorForThemeToken,
  roleSizeMax,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';
import { THRONG_THEME } from '../../src/config/theme.js';

describe('the base font size cannot destroy the application (018)', () => {
  it('caps the base size at a value a window can still be used at', () => {
    /*
     * The defect this bound exists for: the base size feeds every unset role, so a large enough
     * value pushes the chrome off its own window — and the control that would let you put it back is
     * part of the chrome. There is no in-app recovery, only editing the theme file by hand.
     */
    expect(BASE_FONT_MAX_PX).toBe(20);
    expect(descriptorForThemeToken('fonts.baseSizePx').max).toBe(BASE_FONT_MAX_PX);
  });

  it('caps a ROLE size proportionally, at a CONCRETE value', () => {
    /*
     * The pane title ships at 11px against a base of 13, so its ceiling is `round(20 × 11/13)` = 17.
     * That number is pinned deliberately rather than compared to `roleSizeMax(…)`.
     *
     * An earlier version of this test asserted
     * `descriptorForThemeToken(key).max === roleSizeMax(key)` and nothing else, which is TAUTOLOGICAL
     * — the descriptor is built from that function, so mutating the function moves both sides
     * together and the test cannot fail. A mutation that removed the floor passed it. Pinning one
     * real number anchors the rule to something a change has to justify.
     */
    expect(descriptorForThemeToken('typography.paneTitle.sizePx').max).toBe(17);
    expect(roleSizeMax('typography.paneTitle.sizePx')).toBe(17);
    expect(17).toBeLessThan(BASE_FONT_MAX_PX);
  });

  it('bounds every editable size token by the PROPORTIONAL rule, not by one flat ceiling', () => {
    /*
     * A single role added later without a bound reintroduces the whole problem, silently. This is the
     * assertion the E2E could not make at all: it read one slider, not all of them.
     *
     * The rule is proportional, and this test was written wrong first — it asserted a flat ceiling of
     * `BASE_FONT_MAX_PX` and `typography.editor.sizePx` failed it at 22. That is the product being
     * right: `roleSizeMax` scales the base ceiling by the ratio the role SHIPS at, so a surface that
     * ships larger than the base is allowed to stay proportionally larger. The base ceiling exists
     * because oversized CHROME pushes its own controls off the window; an oversized editor is content
     * and merely large. Encoding a flat cap here would have made the suite forbid a shipped, sane
     * value.
     */
    const sizes = themeEditableTokens(THRONG_THEME).filter((k) => k.endsWith('.sizePx'));
    expect(sizes.length).toBeGreaterThan(3);

    /*
     * The ceiling is recomputed HERE, from the theme's shipped sizes, rather than read back from
     * `roleSizeMax`. Comparing the descriptor to that function is tautological — the descriptor is
     * built from it, so a mutation moves both sides together and the loop cannot fail. An earlier
     * version of this test did exactly that, and a vacuity audit caught it; the assertion above was
     * fixed by pinning one number and this one was left with the same defect.
     */
    const base = THRONG_THEME.fonts.baseSizePx;
    const typography = THRONG_THEME.typography as Record<string, { sizePx?: number }>;
    for (const key of sizes) {
      const d = descriptorForThemeToken(key);
      const role = key.split('.')[1] ?? '';
      const shipped = key === 'fonts.baseSizePx' ? base : typography[role]?.sizePx;
      const expected =
        key === 'fonts.baseSizePx'
          ? BASE_FONT_MAX_PX
          : Math.max(8, Math.round(BASE_FONT_MAX_PX * ((shipped ?? base) / base)));
      expect(d.max, `${key} has no maximum, or not the proportional one`).toBe(expected);
      expect(d.max, `${key} is bounded below a size nobody can read`).toBeGreaterThanOrEqual(8);
    }
  });

  /*
   * NOT ASSERTED, and recorded so nobody assumes it is: `roleSizeMax`'s `Math.max(8, …)` floor is
   * UNREACHABLE with the shipped theme. No role ships below 0.4 × the base, so the floor never binds,
   * and a mutation removing it leaves this file green. `roleSizeMax` reads `THRONG_THEME` directly
   * rather than taking a theme, so no synthetic role can reach the branch from outside either.
   *
   * It is left alone rather than papered over with an assertion that would pass for the wrong reason.
   * The branch becomes testable the day that function takes its theme as an argument.
   */
});

describe('the terminal role offers only what xterm can honour (021)', () => {
  const terminalTokens = (): string[] =>
    themeEditableTokens(THRONG_THEME).filter((k) => k.startsWith('typography.terminal.'));

  it('offers the family and the size', () => {
    expect(terminalTokens()).toContain('typography.terminal.family');
    expect(terminalTokens()).toContain('typography.terminal.sizePx');
  });

  it('offers NOTHING else — a control xterm would ignore is a promise the app cannot keep', () => {
    /*
     * xterm renders its own text and honours a family and a size. Offering italic, underline,
     * strikethrough, a case transform or a weight would draw a control that changes a value the
     * terminal then ignores — which reads to a user as a bug in the terminal rather than a control
     * that was never wired.
     */
    for (const gone of ['italic', 'underline', 'strikethrough', 'case', 'weight']) {
      expect(terminalTokens(), `terminal must not offer ${gone}`).not.toContain(
        `typography.terminal.${gone}`,
      );
    }
    expect(terminalTokens()).toHaveLength(2);
  });

  it('still offers the full set to a role that CAN honour it, so the exclusion is deliberate', () => {
    // Non-vacuity: without this, the test above would pass on a build where the theme editor offers
    // no typography attributes to anybody.
    const paneTitle = themeEditableTokens(THRONG_THEME).filter((k) =>
      k.startsWith('typography.paneTitle.'),
    );
    expect(paneTitle).toContain('typography.paneTitle.italic');
    expect(paneTitle.length).toBeGreaterThan(terminalTokens().length);
  });
});
