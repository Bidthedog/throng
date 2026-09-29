import { describe, expect, it } from 'vitest';
import { assertEveryKeyDescribed } from '../../src/config/metadata.js';
import { SHIPPED_DEFAULTS_VERSION, buildShippedDefaults, planThemeUpgrade } from '../../src/config/shipped-defaults.js';
import { THRONG_THEME, type Theme } from '../../src/config/theme.js';
import {
  THEME_METADATA,
  assertThemeAreaGroups,
  descriptorForThemeToken,
  themeEditableTokens,
} from '../../src/config/theme-metadata.js';

/**
 * 047 T015 (research R10, data-model.md "Theme icon tokens") — four icon tokens for section folding:
 * `foldSectionExpanded` ('−') and `foldSectionCollapsed` ('+') for the editor gutter (R4), and
 * `foldPreviewExpanded` ('▾') and `foldPreviewCollapsed` ('▸') for the preview's soft gutter (R6).
 * `collapseAll`/`expandAll` are REUSED for the status-bar Collapse/Expand All toggle — no new token
 * for those. Modelled on 046 T007's `unload`/`category` block in `theme-link-tokens.test.ts`.
 */

const TOKENS = ['foldSectionExpanded', 'foldSectionCollapsed', 'foldPreviewExpanded', 'foldPreviewCollapsed'] as const;
const GLYPHS: Record<(typeof TOKENS)[number], string> = {
  foldSectionExpanded: '−',
  foldSectionCollapsed: '+',
  foldPreviewExpanded: '▾',
  foldPreviewCollapsed: '▸',
};
const D = buildShippedDefaults();

describe('the four fold icon tokens exist, with their documented glyphs (research R10)', () => {
  it('THRONG_THEME carries all four, with the documented glyph', () => {
    for (const t of TOKENS) expect(THRONG_THEME.icons[t], t).toBe(GLYPHS[t]);
  });

  it('every shipped theme carries all four', () => {
    const missing: string[] = [];
    for (const [name, theme] of Object.entries(D.themes)) {
      for (const t of TOKENS) {
        const v = theme.icons?.[t];
        if (typeof v !== 'string' || v.trim() === '') missing.push(`${name}.${t}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the four fold icon tokens are described once, each with its own copy', () => {
  it('each has exactly one descriptor', () => {
    for (const t of TOKENS) {
      expect(THEME_METADATA.filter((d) => d.key === `icons.${t}`), t).toHaveLength(1);
    }
  });

  it('each is an editable icon control, with non-empty label and description', () => {
    for (const t of TOKENS) {
      const d = descriptorForThemeToken(`icons.${t}`);
      expect(d.control, t).toBe('icon');
      expect(d.label.length, t).toBeGreaterThan(0);
      expect(d.description.length, t).toBeGreaterThan(0);
      expect(themeEditableTokens(THRONG_THEME), t).toContain(`icons.${t}`);
    }
  });

  it('the registry-wide guards still hold with them in it', () => {
    expect(() =>
      assertEveryKeyDescribed(themeEditableTokens(THRONG_THEME), THEME_METADATA),
    ).not.toThrow();
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
  });
});

describe('shipped-defaults version 17 — the fold icon tokens reach existing installs (research R10)', () => {
  it('is version 17 or later (re-pinned: 047 round 2 bumps it to 18 for FR-074)', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(18);
  });

  it('fills all four tokens into a version-16 built-in theme', () => {
    const asVersion16 = (theme: Theme): Theme => {
      const t = structuredClone(theme);
      for (const token of TOKENS) delete t.icons[token];
      return t;
    };
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    present.throng = asVersion16(D.themes.throng);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    const filled = plan.fillThemes.find((f) => f.name === 'throng');
    expect(filled, 'throng was not refilled').toBeDefined();
    for (const t of TOKENS) expect(filled!.theme.icons[t], t).toBe(GLYPHS[t]);
  });

  it('is idempotent: re-running the plan against an already-filled install yields nothing to fill', () => {
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(D.themes)) present[name] = structuredClone(theme);
    const plan = planThemeUpgrade({ shipped: D, present, throngBase: D.themes.throng });
    expect(plan.fillThemes).toHaveLength(0);
    expect(plan.addThemes).toHaveLength(0);
  });
});
