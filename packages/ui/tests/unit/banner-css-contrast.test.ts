/**
 * 030 US4 (T056d) / FR-047 — the shared failure banner's text is legible against its own background in
 * EVERY shipped theme.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/default-themes.e2e.ts` (pass 2): the E2E activated each of the fifteen
 * themes in a real window and read the banner's computed colours (about 7 s). The banner paints
 * `color: var(--throng-colour-errorText)` on `background: var(--throng-colour-errorSurface)`
 * (`panel-failure-banner.css`), and `toCssVariables` is what turns a theme into those custom properties, so the
 * claim reduces to a ratio between two emitted values per theme. The E2E keeps one light and one dark theme to
 * witness that the real cascade delivers them.
 *
 * Layer: unit. The token NAMES are read from the stylesheet (so repointing the banner at another token pair is
 * caught), the VALUES come from `toCssVariables(theme)` for every record in `ALL_DEFAULT_THEMES`, and the ratio is
 * the WCAG one `theme-quality` uses. 3:1 is WCAG's non-text / large-text floor — a banner is a headline plus icon
 * controls, and the claim is legibility, not body-copy AA.
 *
 * ANTI-VACUITY: the rule must be found and name two tokens, fifteen themes must be swept, and the ratio function
 * is run against a pair it must reject.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES, contrastRatio, toCssVariables } from '@throng/core';

const CSS = fileURLToPath(new URL('../../src/renderer/common/panel-failure-banner.css', import.meta.url));

/** The custom property a declaration of `prop` in the bare `.panel-failure` rule points at. */
function tokenOf(prop: 'color' | 'background'): string {
  const source = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /(?:^|\})\s*\.panel-failure\s*\{([^{}]*)\}/.exec(source);
  expect(rule, 'the bare .panel-failure rule is not in panel-failure-banner.css').not.toBeNull();
  const decl = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*var\\((--[A-Za-z0-9-]+)`).exec(rule![1]!);
  expect(decl, `.panel-failure declares no ${prop}: var(--…)`).not.toBeNull();
  return decl![1]!;
}

describe('the failure banner is legible in every shipped theme (FR-047)', () => {
  it('the ratio check rejects an unreadable pair (control)', () => {
    expect(contrastRatio('#777777', '#808080')).toBeLessThan(3);
    expect(contrastRatio('#ffffff', '#000000')).toBeGreaterThanOrEqual(3);
  });

  it('errorText on errorSurface clears 3:1 in each of the fifteen themes', () => {
    const textVar = tokenOf('color');
    const surfaceVar = tokenOf('background');
    expect(textVar, 'the banner text token').toBe('--throng-colour-errorText');
    expect(surfaceVar, 'the banner surface token').toBe('--throng-colour-errorSurface');

    const themes = Object.entries(ALL_DEFAULT_THEMES);
    expect(themes, 'fifteen themes are swept').toHaveLength(15);
    for (const [name, theme] of themes) {
      const vars = toCssVariables(theme);
      const fg = vars[textVar];
      const bg = vars[surfaceVar];
      expect(fg, `${name}: no ${textVar} emitted`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(bg, `${name}: no ${surfaceVar} emitted`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(
        contrastRatio(fg!, bg!),
        `${name}: the failure banner is not legible (${fg} on ${bg})`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
