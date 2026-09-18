import { describe, expect, it } from 'vitest';
import { assertEveryKeyDescribed } from '../../src/config/metadata.js';
import {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  planThemeUpgrade,
} from '../../src/config/shipped-defaults.js';
import { THRONG_THEME, TOKEN_PARENT, resolveSplitColour, type Theme } from '../../src/config/theme.js';
import {
  THEME_METADATA,
  assertThemeAreaGroups,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';

/**
 * 045 FR-138 — `data-model.md` §14.3, `contracts/menus-and-gestures.md` §7.6.
 *
 * Links in both panel types are marked by an underline drawn from two theme tokens:
 *
 *   linkUnderline       parent `accent`         General   at-rest underline
 *   linkUnderlineHover  parent `linkUnderline`  General   hover underline
 *
 * A token the Themes editor cannot edit breaks the configuration-editor completeness rule
 * (NON-NEGOTIABLE), so each must have exactly one descriptor, in a closed-set area. And theme files
 * reach a new token ONLY through the additive upgrade `SHIPPED_DEFAULTS_VERSION` gates, so the
 * version must move — or every existing install draws its links with no underline colour at all.
 */

const TOKENS = ['linkUnderline', 'linkUnderlineHover'] as const;
const D = buildShippedDefaults();

describe('the two link tokens exist in every shipped theme (FR-138)', () => {
  it('THRONG_THEME carries both', () => {
    for (const t of TOKENS) expect(THRONG_THEME.colours[t], t).toMatch(/\S/);
  });

  it('every shipped theme carries both', () => {
    const missing: string[] = [];
    for (const [name, theme] of Object.entries(D.themes)) {
      for (const t of TOKENS) {
        const v = theme.colours?.[t];
        if (typeof v !== 'string' || v.trim() === '') missing.push(`${name}.${t}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the two link tokens inherit (FR-138)', () => {
  it('linkUnderline’s parent is accent; linkUnderlineHover’s parent is linkUnderline', () => {
    expect(TOKEN_PARENT.linkUnderline).toBe('accent');
    expect(TOKEN_PARENT.linkUnderlineHover).toBe('linkUnderline');
  });

  it('a theme authored before the tokens takes its own accent for the at-rest underline', () => {
    const old: Theme = { ...structuredClone(THRONG_THEME), name: 'Old' };
    old.colours = { ...old.colours, accent: '#ff0000' };
    delete old.colours.linkUnderline;
    delete old.colours.linkUnderlineHover;
    expect(resolveSplitColour(old, 'linkUnderline')).toBe('#ff0000');
  });

  it('a theme that sets only linkUnderline takes it for the hover underline too', () => {
    const t: Theme = { ...structuredClone(THRONG_THEME), name: 'Mine' };
    t.colours = { ...t.colours, linkUnderline: '#00ff00' };
    delete t.colours.linkUnderlineHover;
    expect(resolveSplitColour(t, 'linkUnderlineHover')).toBe('#00ff00');
  });
});

describe('the two link tokens are described once, in the General area (FR-138)', () => {
  it('each has exactly one descriptor', () => {
    for (const t of TOKENS) {
      expect(THEME_METADATA.filter((d) => d.key === `colours.${t}`), t).toHaveLength(1);
    }
  });

  it('both are editable colour tokens in General', () => {
    for (const t of TOKENS) {
      const d = descriptorForThemeToken(`colours.${t}`);
      expect(d.control, t).toBe('colour');
      expect(d.group, t).toBe('General');
      expect(themeEditableTokens(THRONG_THEME), t).toContain(`colours.${t}`);
    }
  });

  it('the registry-wide guards still hold with them in it', () => {
    expect(() =>
      assertEveryKeyDescribed(themeEditableTokens(THRONG_THEME), THEME_METADATA),
    ).not.toThrow();
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
  });
});

describe('shipped-defaults version 10 — the link tokens reach existing installs (FR-138)', () => {
  it('is version 10', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(10);
  });

  it('fills both tokens into a version-9 built-in theme', () => {
    const asVersion9 = (theme: Theme): Theme => {
      const t = structuredClone(theme);
      delete t.colours.linkUnderline;
      delete t.colours.linkUnderlineHover;
      return t;
    };
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    present.throng = asVersion9(D.themes.throng);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    const filled = plan.fillThemes.find((f) => f.name === 'throng');
    expect(filled, 'throng was not refilled').toBeDefined();
    for (const t of TOKENS) expect(filled!.theme.colours[t], t).toMatch(/\S/);
  });
});
