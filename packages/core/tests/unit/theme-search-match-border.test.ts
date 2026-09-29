import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '../../src/index.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import {
  THEME_METADATA,
  assertThemeAreaGroups,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';
import { assertEveryKeyDescribed } from '../../src/config/metadata.js';
import {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  planThemeUpgrade,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 047 FR-074 (MT-01) — `searchMatchBorder`, the outline every ordinary find match now carries. Its
 * contrast and distinctness are measured in `theme-quality.test.ts`; this file covers the token's
 * plumbing: copy, the theme editor, and the additive upgrade that brings it to an existing install.
 */
describe('searchMatchBorder (047 FR-074)', () => {
  it('exists in THRONG_THEME.colours, with a label and description', () => {
    expect(THRONG_THEME.colours.searchMatchBorder, 'no colour value shipped').toMatch(/^#[0-9a-f]{6}$/i);
    const copy = THEME_TOKEN_COPY['colours.searchMatchBorder'];
    expect(copy, 'no hand-written copy').toBeDefined();
    expect(copy!.label).toBe('Search Match Border');
    expect(copy!.description.length).toBeGreaterThan(0);
  });

  it('is an editable colour token in the Search group', () => {
    expect(themeEditableTokens(THRONG_THEME)).toContain('colours.searchMatchBorder');
    const d = descriptorForThemeToken('colours.searchMatchBorder');
    expect(d.control).toBe('colour');
    expect(d.group).toBe('Search');
    expect(() =>
      assertEveryKeyDescribed(themeEditableTokens(THRONG_THEME), THEME_METADATA),
    ).not.toThrow();
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
  });

  it('is shipped-defaults version 18, so an existing install receives it', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(18);
  });

  it('arrives through the additive upgrade into every theme file that lacks it', () => {
    const shipped = buildShippedDefaults();
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(shipped.themes)) {
      const t = structuredClone(theme);
      delete (t.colours as Record<string, string>).searchMatchBorder;
      present[name] = t;
    }
    const plan = planThemeUpgrade({ shipped, present, throngBase: shipped.themes.throng });
    expect(plan.fillThemes.map((f) => f.name).sort()).toEqual(Object.keys(shipped.themes).sort());
    for (const f of plan.fillThemes) {
      expect(f.theme.colours.searchMatchBorder, f.name).toBe(shipped.themes[f.name]!.colours.searchMatchBorder);
    }
  });

  it('leaves a value the user chose alone', () => {
    const shipped = buildShippedDefaults();
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(shipped.themes)) present[name] = structuredClone(theme);
    (present.throng!.colours as Record<string, string>).searchMatchBorder = '#ff00ff';
    const plan = planThemeUpgrade({ shipped, present, throngBase: shipped.themes.throng });
    expect(plan.fillThemes.find((f) => f.name === 'throng')).toBeUndefined();
  });
});
