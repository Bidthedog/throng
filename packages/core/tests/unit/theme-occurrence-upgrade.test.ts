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
import { SHIPPED_DEFAULTS_VERSION, buildShippedDefaults, planThemeUpgrade } from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 049 T031 — the three new colour tokens' plumbing: copy, the Themes editor (FR-012), and the additive
 * upgrade that brings them to an existing install. Their colour rules are `theme-occurrence-surfaces.test.ts`.
 */
const TOKENS = [
  ['searchMatchOccurrence', 'Search', 'Selection Occurrence Highlight'],
  ['searchMatchOccurrenceInactive', 'Search', 'Inactive Selection Occurrence Highlight'],
  ['editorSelectionInactive', 'Editor', 'Editor Inactive Selection'],
] as const;

describe('049 occurrence and inactive-selection tokens', () => {
  it.each(TOKENS)('%s is an editable colour in the %s group, labelled "%s"', (token, group, label) => {
    const key = `colours.${token}`;
    expect((THRONG_THEME.colours as Record<string, string>)[token]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME_TOKEN_COPY[key]?.label).toBe(label);
    expect(themeEditableTokens(THRONG_THEME)).toContain(key);
    const d = descriptorForThemeToken(key);
    expect(d.control).toBe('colour');
    expect(d.group).toBe(group);
  });

  it('leaves every editable token described and every area grouped', () => {
    expect(() => assertEveryKeyDescribed(themeEditableTokens(THRONG_THEME), THEME_METADATA)).not.toThrow();
    expect(() => assertThemeAreaGroups(THEME_METADATA)).not.toThrow();
  });

  it('is shipped-defaults version 19 or later, so an existing install receives them (re-pinned: 049 round 2 bumps it to 20)', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(20);
  });

  it('arrive through the additive upgrade into every theme file that lacks them', () => {
    const shipped = buildShippedDefaults();
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(shipped.themes)) {
      const t = structuredClone(theme);
      for (const [token] of TOKENS) delete (t.colours as Record<string, string>)[token];
      present[name] = t;
    }
    const plan = planThemeUpgrade({ shipped, present, throngBase: shipped.themes.throng });
    expect(plan.fillThemes.map((f) => f.name).sort()).toEqual(Object.keys(shipped.themes).sort());
    for (const f of plan.fillThemes) {
      for (const [token] of TOKENS) {
        expect((f.theme.colours as Record<string, string>)[token], `${f.name}.${token}`).toBe(
          (shipped.themes[f.name]!.colours as Record<string, string>)[token],
        );
      }
    }
  });

  it('leaves a value the user chose alone', () => {
    const shipped = buildShippedDefaults();
    const present: Record<string, Theme> = {};
    for (const [name, theme] of Object.entries(shipped.themes)) present[name] = structuredClone(theme);
    (present.throng!.colours as Record<string, string>).editorSelectionInactive = '#ff00ff';
    const plan = planThemeUpgrade({ shipped, present, throngBase: shipped.themes.throng });
    expect(plan.fillThemes.find((f) => f.name === 'throng')).toBeUndefined();
  });
});
