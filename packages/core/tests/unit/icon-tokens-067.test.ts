import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';

const TOKENS = ['save', 'saveAs'] as const;

describe('067 icon tokens (FR-074)', () => {
  it.each(TOKENS)('%s is carried by every shipped theme', (token) => {
    for (const [name, theme] of [['throng', THRONG_THEME] as const, ...Object.entries(ALL_DEFAULT_THEMES)]) {
      expect(theme.icons[token], `${name}.${token}`).toBeTruthy();
    }
  });

  it.each(TOKENS)('%s has its label and description for the Themes editor', (token) => {
    expect(THEME_TOKEN_COPY[`icons.${token}`]?.label).toBeTruthy();
    expect(THEME_TOKEN_COPY[`icons.${token}`]?.description).toBeTruthy();
  });

  it('draws Save and Save As as disks, not arrows (FR-118)', () => {
    expect(THRONG_THEME.icons.save).toBe('🖪');
    expect(THRONG_THEME.icons.saveAs).toBe('🖫');
  });

  /* Maintainer, 2026-11-10: every default icon is a simple monochrome glyph, which takes the theme's
     icon colour. An emoji code point (Extended_Pictographic) can draw in colour from an emoji font,
     even one whose default presentation is text, so none ships in the default set. */
  it.each(Object.keys(THRONG_THEME.icons))('%s is a monochrome glyph, not an emoji', (token) => {
    const glyph = String(THRONG_THEME.icons[token as keyof typeof THRONG_THEME.icons]);
    expect(glyph, token).not.toMatch(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️/u);
  });

  it('keeps the three glyphs distinct', () => {
    expect(new Set(TOKENS.map((t) => THRONG_THEME.icons[t])).size).toBe(TOKENS.length);
  });
});
