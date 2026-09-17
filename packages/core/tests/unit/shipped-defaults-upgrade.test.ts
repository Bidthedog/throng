import { describe, expect, it } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  fillMissingThemeProps,
  planThemeUpgrade,
  type Theme,
} from '@throng/core';

const D = buildShippedDefaults();
const throngBase = D.themes.throng;

function makeTheme(name: string, overrides: Partial<Theme> = {}): Theme {
  return {
    name,
    colours: { accent: '#abc', text: '#fff' },
    fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } },
    icons: { destroy: '×' },
    ...overrides,
  };
}

describe('fillMissingThemeProps (010, FR-015a additive fill)', () => {
  it('adds only keys absent from user; never overwrites a present value', () => {
    const user = makeTheme('U', { colours: { accent: '#user' } });
    const source = makeTheme('S', { colours: { accent: '#src', newToken: '#new' } });
    const filled = fillMissingThemeProps(user, source);
    expect(filled.colours.accent).toBe('#user'); // present → kept
    expect(filled.colours.newToken).toBe('#new'); // absent → filled
  });

  it('fills a deeply-nested absent property without touching present ones', () => {
    const user = makeTheme('U', { typography: { editor: { sizePx: 20 } } });
    const source = makeTheme('S', { typography: { editor: { sizePx: 14, family: 'mono' } } });
    const filled = fillMissingThemeProps(user, source);
    expect(filled.typography!.editor!.sizePx).toBe(20); // present → kept
    expect(filled.typography!.editor!.family).toBe('mono'); // absent → filled
  });

  it('does not mutate the user theme', () => {
    const user = makeTheme('U');
    const before = JSON.stringify(user);
    fillMissingThemeProps(user, makeTheme('S', { colours: { accent: '#x', extra: '#y' } }));
    expect(JSON.stringify(user)).toBe(before);
  });
});

describe('planThemeUpgrade (010, FR-015a)', () => {
  it('lists reserved themes absent from present as addThemes', () => {
    const present: Record<string, Theme> = { throng: throngBase };
    const plan = planThemeUpgrade({ shipped: D, present, throngBase });
    const added = plan.addThemes.map((a) => a.name);
    expect(added).toContain('Matrix');
    expect(added).not.toContain('throng'); // present → not re-added
  });

  it('lists a present theme needing a property fill', () => {
    // A built-in missing a colour token → fillThemes (from its shipped value).
    const strippedMatrix: Theme = { ...D.themes.Matrix, colours: { accent: D.themes.Matrix.colours.accent } };
    const present: Record<string, Theme> = { ...allPresent(), Matrix: strippedMatrix };
    const plan = planThemeUpgrade({ shipped: D, present, throngBase });
    expect(plan.addThemes).toHaveLength(0); // all present
    const filledMatrix = plan.fillThemes.find((f) => f.name === 'Matrix');
    expect(filledMatrix).toBeDefined();
    // A shipped colour token that was stripped is materialised from the shipped value.
    expect(filledMatrix!.theme.colours.appBg).toBe(D.themes.Matrix.colours.appBg);
    expect(filledMatrix!.theme.colours.accent).toBe(D.themes.Matrix.colours.accent); // present kept
  });

  it('fills a custom theme from the throng base', () => {
    const custom: Theme = { name: 'Mine', colours: { accent: '#mine' }, fonts: throngBase.fonts, icons: {} };
    const present: Record<string, Theme> = { ...allPresent(), Mine: custom };
    const plan = planThemeUpgrade({ shipped: D, present, throngBase });
    const filledMine = plan.fillThemes.find((f) => f.name === 'Mine');
    expect(filledMine).toBeDefined();
    expect(filledMine!.theme.colours.accent).toBe('#mine'); // custom value kept
    expect(filledMine!.theme.colours.appBg).toBe(throngBase.colours.appBg); // filled from throng base
  });

  it('is idempotent: an already-complete config yields empty lists', () => {
    const plan = planThemeUpgrade({ shipped: D, present: allPresent(), throngBase });
    expect(plan.addThemes).toHaveLength(0);
    expect(plan.fillThemes).toHaveLength(0);
  });
});

/*
 * 044, 2026-09-16 iteration (FR-122c; contracts/settings-bindings-tokens.md "Shipped defaults — 8 → 9").
 * One new icon token, `syncScroll`, and theme files reach a new token only through the additive upgrade
 * the version gates — so the version moves, or every install already holding an 8 marker (every
 * hand-testing build of this branch) draws the new toggle as an empty box. 043's 6 → 7 is the precedent.
 */
describe('shipped-defaults version 9 — the syncScroll icon (044 FR-122c)', () => {
  it('is version 9', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(9);
  });

  /** A theme as a version-8 install holds it: everything shipped, except the token 9 adds. */
  function asVersion8(theme: Theme): Theme {
    const icons = { ...theme.icons };
    delete icons.syncScroll;
    return { ...structuredClone(theme), icons };
  }

  it('fills icons.syncScroll into a version-8 built-in theme and a version-8 custom theme', () => {
    const custom: Theme = { ...asVersion8(throngBase), name: 'Mine' };
    const present: Record<string, Theme> = { ...allPresent(), Matrix: asVersion8(D.themes.Matrix), Mine: custom };
    const plan = planThemeUpgrade({ shipped: D, present, throngBase });
    const matrix = plan.fillThemes.find((f) => f.name === 'Matrix');
    const mine = plan.fillThemes.find((f) => f.name === 'Mine');
    expect(matrix?.theme.icons.syncScroll).toBe(D.themes.Matrix.icons.syncScroll);
    expect(matrix?.theme.icons.syncScroll).toBeTruthy();
    expect(mine?.theme.icons.syncScroll).toBe(throngBase.icons.syncScroll);
  });

  it('keeps a user value for icons.syncScroll a version-8 theme already holds', () => {
    const own = { ...asVersion8(D.themes.Matrix) };
    own.icons = { ...own.icons, syncScroll: 'S' };
    const present: Record<string, Theme> = { ...allPresent(), Matrix: own };
    const plan = planThemeUpgrade({ shipped: D, present, throngBase });
    // Nothing to fill, so Matrix is not rewritten at all — and its glyph stays the user's.
    expect(plan.fillThemes.find((f) => f.name === 'Matrix')).toBeUndefined();
    expect(fillMissingThemeProps(own, D.themes.Matrix).icons.syncScroll).toBe('S');
  });
});

/** Every reserved theme, exactly as shipped (a fully up-to-date config). */
function allPresent(): Record<string, Theme> {
  const out: Record<string, Theme> = {};
  for (const [name, theme] of Object.entries(D.themes)) out[name] = structuredClone(theme);
  return out;
}
