import { describe, expect, it } from 'vitest';
import {
  ALL_DEFAULT_THEMES,
  ENTRY_BASE_SURFACE_TOKEN,
  ENTRY_SEVERITIES,
  ENTRY_TINT_PERCENT,
  ENTRY_TYPE_COLOUR_TOKEN,
  ENTRY_TYPE_ICON_TOKEN,
  THRONG_THEME,
  resolveColour,
} from '@throng/core';
import { contrastRatio, hexToRgb } from '../../../src/config/colour-math.js';
import { THEME_TOKEN_COPY } from '../../../src/config/theme-copy.js';

/**
 * 068 T103–T105 (FR-071, FR-074) — what a Notifications panel entry looks like by TYPE: a pastel tint of the type's colour
 * behind its text, and an icon of its own. Layer: unit — the mapping and the theme data are plain; the stylesheet and the
 * rendering are `notification-entry-look.test.ts`'s (component).
 */

const blend = (fg: string, bg: string, percent: number): string => {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  const mix = (x: number, y: number): number => Math.round((x * percent + y * (100 - percent)) / 100);
  return `#${[mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

const THEMES = [['throng', THRONG_THEME] as const, ...Object.entries(ALL_DEFAULT_THEMES)];

describe('the tint is pastel and the text stays readable (FR-071)', () => {
  it('is a modest share of the type colour, so it is understated', () => {
    expect(ENTRY_TINT_PERCENT).toBeGreaterThan(0);
    expect(ENTRY_TINT_PERCENT).toBeLessThanOrEqual(20);
  });

  it.each(THEMES)('%s: the entry text reaches 4.5:1 on every type\'s tint', (_name, theme) => {
    const surface = resolveColour(theme, ENTRY_BASE_SURFACE_TOKEN);
    const text = resolveColour(theme, 'text');
    for (const severity of ENTRY_SEVERITIES) {
      const tint = blend(resolveColour(theme, ENTRY_TYPE_COLOUR_TOKEN[severity]), surface, ENTRY_TINT_PERCENT);
      expect(contrastRatio(text, tint), `${severity} in ${_name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('maps every type to a colour token each theme carries', () => {
    expect(Object.keys(ENTRY_TYPE_COLOUR_TOKEN).sort()).toEqual([...ENTRY_SEVERITIES].sort());
    for (const [name, theme] of THEMES) {
      for (const severity of ENTRY_SEVERITIES) {
        expect(() => resolveColour(theme, ENTRY_TYPE_COLOUR_TOKEN[severity]), `${name}.${severity}`).not.toThrow();
      }
    }
  });
});

describe('every type has its own themeable icon (FR-074)', () => {
  const tokens = ENTRY_SEVERITIES.map((s) => ENTRY_TYPE_ICON_TOKEN[s]);

  it('five types, five different tokens', () => {
    expect(new Set(tokens).size).toBe(ENTRY_SEVERITIES.length);
  });

  it.each(THEMES)('%s carries every one as a monochrome glyph', (name, theme) => {
    for (const token of tokens) {
      const glyph = theme.icons[token];
      expect(glyph, `${name}.${token}`).toBeTruthy();
      expect(String(glyph)).not.toMatch(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️/u);
    }
  });

  it('keeps the glyphs distinct from each other', () => {
    const glyphs = tokens.map((t) => THRONG_THEME.icons[t]);
    expect(new Set(glyphs).size).toBe(tokens.length);
  });

  it('has a label and a description for each new token in the Themes editor', () => {
    for (const token of tokens.filter((t) => t.startsWith('notice'))) {
      expect(THEME_TOKEN_COPY[`icons.${token}`]?.label, token).toBeTruthy();
      expect(THEME_TOKEN_COPY[`icons.${token}`]?.description, token).toBeTruthy();
    }
  });
});
