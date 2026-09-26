import { describe, expect, it } from 'vitest';
import { THRONG_THEME, planThemeUpgrade } from '../../src/index.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { TOKEN_PARENT } from '../../src/config/theme.js';
import {
  THEME_METADATA,
  assertThemeAreaGroups,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';
import { assertEveryKeyDescribed } from '../../src/config/metadata.js';
import { buildShippedDefaults } from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 046 iterate round 1 (FR-072) — `categoryHeaderBackground`, the Projects pane's category header
 * surface. Bold and uppercase already ship; this is the one thing still missing, a colour token so
 * the header reads as its own strip rather than borrowing whatever the pane body happens to be.
 */
describe('categoryHeaderBackground (FR-072)', () => {
  it('exists in THRONG_THEME.colours, with a label and description', () => {
    expect(THRONG_THEME.colours.categoryHeaderBackground, 'no colour value shipped').toMatch(/\S/);
    const copy = THEME_TOKEN_COPY['colours.categoryHeaderBackground'];
    expect(copy, 'no hand-written copy').toBeDefined();
    expect(copy!.label.length).toBeGreaterThan(0);
    expect(copy!.description.length).toBeGreaterThan(0);
  });

  it('is listed for the theme editor, as an editable colour token', () => {
    expect(themeEditableTokens(THRONG_THEME)).toContain('colours.categoryHeaderBackground');
    const d = descriptorForThemeToken('colours.categoryHeaderBackground');
    expect(d.control).toBe('colour');
    expect(d.group).toBe('Projects / sidebar');
  });

  it('the registry-wide completeness and area-group guards still hold with it in place', () => {
    expect(() =>
      assertEveryKeyDescribed(themeEditableTokens(THRONG_THEME), THEME_METADATA),
    ).not.toThrow();
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
  });

  it('arrives through the additive version-13 upgrade into a theme file that lacks it', () => {
    const shipped = buildShippedDefaults();
    const asVersion12 = (theme: Theme): Theme => {
      const t = structuredClone(theme);
      delete (t.colours as Record<string, string>).categoryHeaderBackground;
      return t;
    };
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(shipped.themes)) present[name] = structuredClone(theme);
    present.throng = asVersion12(shipped.themes.throng);

    const plan = planThemeUpgrade({ shipped, present, throngBase: shipped.themes.throng });
    const filled = plan.fillThemes.find((f) => f.name === 'throng');
    expect(filled, 'throng was not refilled').toBeDefined();
    expect(filled!.theme.colours.categoryHeaderBackground).toMatch(/\S/);
  });

  it('is idempotent: re-running the plan against an already-filled install yields nothing to fill for it', () => {
    const shipped = buildShippedDefaults();
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(shipped.themes)) present[name] = structuredClone(theme);
    const plan = planThemeUpgrade({ shipped, present, throngBase: shipped.themes.throng });
    expect(plan.fillThemes).toHaveLength(0);
    expect(plan.addThemes).toHaveLength(0);
  });

  /**
   * Review finding IMPORTANT 5: the token existed but was given the SAME literal value as
   * `sidebarBg`/`railBg` in every bundled theme, so FR-072's "the header reads as its own strip"
   * was not actually met — a header painted the exact colour of the pane body it sits on is
   * indistinguishable from having no background token at all.
   */
  it('is VISIBLY DISTINCT from sidebarBg in every bundled theme, throng included (IMPORTANT 5)', () => {
    const notDistinct: string[] = [];
    for (const [name, theme] of Object.entries({ throng: THRONG_THEME, ...ALL_DEFAULT_THEMES })) {
      if (theme.colours.categoryHeaderBackground === theme.colours.sidebarBg) notDistinct.push(name);
    }
    expect(notDistinct, 'these themes paint the header the same colour as the pane body').toEqual([]);
  });

  it('follows the raised-surface token TOKEN_PARENT actually names, matching its own copy (IMPORTANT 5, MINOR 11)', () => {
    expect(TOKEN_PARENT.categoryHeaderBackground).toBe('surfaceActive');
    const copy = THEME_TOKEN_COPY['colours.categoryHeaderBackground'];
    // The description must name the SAME fallback TOKEN_PARENT declares, not a stale one.
    expect(copy!.description).toMatch(/raised surface/i);
    expect(copy!.description).not.toMatch(/side panel/i);
  });
});
