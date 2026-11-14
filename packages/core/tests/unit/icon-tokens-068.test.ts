import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';

/**
 * 068 US3 T044 (FR-026, FR-036, FR-038) — the icon tokens the Notifications panel and the minimise
 * controls draw: `notifications`, `dismissAll`, `sortOrder`, `minimisePanel`, `restorePanel`.
 * Modelled on `icon-tokens-067.test.ts`. Layer: unit — the theme model is plain data.
 */
const TOKENS = ['notifications', 'dismissAll', 'sortOrder', 'minimisePanel', 'restorePanel'] as const;

describe('068 icon tokens', () => {
  it.each(TOKENS)('%s is carried by every shipped theme', (token) => {
    for (const [name, theme] of [['throng', THRONG_THEME] as const, ...Object.entries(ALL_DEFAULT_THEMES)]) {
      expect(theme.icons[token], `${name}.${token}`).toBeTruthy();
    }
  });

  it.each(TOKENS)('%s has its label and description for the Themes editor', (token) => {
    expect(THEME_TOKEN_COPY[`icons.${token}`]?.label).toBeTruthy();
    expect(THEME_TOKEN_COPY[`icons.${token}`]?.description).toBeTruthy();
  });

  // FR-058: the minimise and restore CONTROLS draw the side panes' chevron, so these two tokens drive only the menu items.
  it.each(['minimisePanel', 'restorePanel'] as const)('%s is described as the menu item\'s icon, not the control\'s glyph', (token) => {
    const { description } = THEME_TOKEN_COPY[`icons.${token}`]!;
    expect(description).toMatch(/menu item/i);
    expect(description).not.toMatch(/glyph on the control/i);
  });

  // Maintainer, 2026-11-10: every default icon is a simple monochrome glyph that takes the icon colour.
  it.each(TOKENS)('%s is a monochrome glyph, not an emoji', (token) => {
    expect(THRONG_THEME.icons[token]).not.toMatch(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️/u);
  });

  it('keeps the five glyphs distinct from each other, and from dismiss, collapse and expand', () => {
    const glyphs = TOKENS.map((t) => THRONG_THEME.icons[t]);
    expect(new Set(glyphs).size).toBe(TOKENS.length);
    for (const other of ['dismiss', 'collapse', 'expand', 'cancel'] as const) {
      expect(glyphs, other).not.toContain(THRONG_THEME.icons[other]);
    }
  });

  it('bumps the shipped defaults to version 32 so an existing install gains the tokens', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(33);
  });
});
