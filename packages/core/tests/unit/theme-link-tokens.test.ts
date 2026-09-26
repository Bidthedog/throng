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
  it('is at least version 10', () => {
    // 045's round four moved the version on to 11 (below); what this block guards is that the
    // linkUnderline fill is still inside the sequence.
    expect(SHIPPED_DEFAULTS_VERSION).toBeGreaterThanOrEqual(10);
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

/*
 * 045 round four, FR-165g — the plain-click link hint's own surface, text and border. Same shape as
 * FR-138's pair above: each token must be drawn (descriptor, General area), inherit from a carved-out
 * role rather than `accent` (so an old theme's hint reads like its cards and text, not like its
 * links), and reach an existing install through the additive upgrade.
 */
const HINT_TOKENS = ['linkHintBackground', 'linkHintText', 'linkHintBorder'] as const;
const HINT_PARENTS: Record<(typeof HINT_TOKENS)[number], string> = {
  linkHintBackground: 'surfaceActive',
  linkHintText: 'text',
  linkHintBorder: 'border',
};

describe('the three link hint tokens exist in every shipped theme (FR-165g)', () => {
  it('THRONG_THEME carries all three', () => {
    for (const t of HINT_TOKENS) expect(THRONG_THEME.colours[t], t).toMatch(/\S/);
  });

  it('every shipped theme carries all three', () => {
    const missing: string[] = [];
    for (const [name, theme] of Object.entries(D.themes)) {
      for (const t of HINT_TOKENS) {
        const v = theme.colours?.[t];
        if (typeof v !== 'string' || v.trim() === '') missing.push(`${name}.${t}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the three link hint tokens inherit from a carved-out role, not from accent (FR-165g)', () => {
  it('each token’s parent is the role it draws like at rest', () => {
    for (const t of HINT_TOKENS) expect(TOKEN_PARENT[t], t).toBe(HINT_PARENTS[t]);
  });

  it('a theme authored before the hint existed takes its own surfaceActive/text/border', () => {
    const old: Theme = { ...structuredClone(THRONG_THEME), name: 'Old' };
    old.colours = { ...old.colours, surfaceActive: '#111111', text: '#222222', border: '#333333' };
    delete old.colours.linkHintBackground;
    delete old.colours.linkHintText;
    delete old.colours.linkHintBorder;
    expect(resolveSplitColour(old, 'linkHintBackground')).toBe('#111111');
    expect(resolveSplitColour(old, 'linkHintText')).toBe('#222222');
    expect(resolveSplitColour(old, 'linkHintBorder')).toBe('#333333');
  });
});

describe('the three link hint tokens are described once, in the General area (FR-165g)', () => {
  it('each has exactly one descriptor', () => {
    for (const t of HINT_TOKENS) {
      expect(THEME_METADATA.filter((d) => d.key === `colours.${t}`), t).toHaveLength(1);
    }
  });

  it('all three are editable colour tokens in General', () => {
    for (const t of HINT_TOKENS) {
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

describe('shipped-defaults version 11 — the link hint tokens reach existing installs (FR-165g)', () => {
  it('is version 14 (046 iterate round 3, T175 bumps it again for FR-118s B / N / M remap, after iterate round 1s 13)', () => {
    // Re-pinned: 046 iterate round 5 (FR-124) bumps it to 15 for word wrap's Ctrl+E,W.
    // Re-pinned: 046 iterate round 7 (FR-127) bumps it to 16 for the panel reset's Ctrl+Alt+0.
    expect(SHIPPED_DEFAULTS_VERSION).toBe(16);
  });

  it('fills all three tokens into a version-10 built-in theme', () => {
    const asVersion10 = (theme: Theme): Theme => {
      const t = structuredClone(theme);
      delete t.colours.linkHintBackground;
      delete t.colours.linkHintText;
      delete t.colours.linkHintBorder;
      return t;
    };
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    present.throng = asVersion10(D.themes.throng);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    const filled = plan.fillThemes.find((f) => f.name === 'throng');
    expect(filled, 'throng was not refilled').toBeDefined();
    for (const t of HINT_TOKENS) expect(filled!.theme.colours[t], t).toMatch(/\S/);
  });

  it('is idempotent: re-running the plan against an already-filled install yields nothing to fill', () => {
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    expect(plan.fillThemes).toHaveLength(0);
    expect(plan.addThemes).toHaveLength(0);
  });
});

/**
 * 046 T007 (FR-061, R11) — the side-pane icon tokens the version-12 seed carried. `unload` and
 * `category` are the two that survive today; `projectList`, the third, was retired (branch-review
 * finding, 046 iterate round 2) — see `theme-migration.test.ts`'s "retired icon tokens" block for
 * what happens to it on an install that already received it.
 */
const SIDE_PANE_ICON_TOKENS = ['unload', 'category'] as const;

describe('shipped-defaults version 12 — the side-pane icon tokens reach existing installs (FR-061, R11)', () => {
  it('THRONG_THEME carries both', () => {
    for (const t of SIDE_PANE_ICON_TOKENS) expect(THRONG_THEME.icons[t], t).toBeTruthy();
  });

  it('fills both tokens into a version-11 built-in theme', () => {
    const asVersion11 = (theme: Theme): Theme => {
      const t = structuredClone(theme);
      delete t.icons.unload;
      delete t.icons.category;
      return t;
    };
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    present.throng = asVersion11(D.themes.throng);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    const filled = plan.fillThemes.find((f) => f.name === 'throng');
    expect(filled, 'throng was not refilled').toBeDefined();
    for (const t of SIDE_PANE_ICON_TOKENS) expect(filled!.theme.icons[t], t).toMatch(/\S/);
  });

  it('is idempotent: re-running the plan against an already-filled install yields nothing to fill', () => {
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    expect(plan.fillThemes).toHaveLength(0);
    expect(plan.addThemes).toHaveLength(0);
  });
});
