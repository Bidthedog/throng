import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';
import { THRONG_THEME, toCssVariables } from '../../src/config/theme.js';
import { migrateTheme } from '../../src/config/theme-ops.js';
import { contrastRatio, readableTextOn } from '../../src/config/theme-quality.js';

/**
 * 057 (research R11) — the attention mark's theme tokens.
 *
 * Round 13 (FR-135, FR-139) made every mark one circle in `attentionMark`, the same for an Attention and a
 * Failed mark, with no glyph: `attentionFailedMark` and the `attention` / `attentionFailed` icons are
 * retired, and the number inside the circle takes `--throng-attention-mark-text`, DERIVED from the fill
 * by 046 FR-072a's black-or-white rule (FR-136), so a user's own `attentionMark` reads too.
 *
 * Layer: unit — pure data over the bundled themes.
 */
const RETIRED_ICONS = ['attention', 'attentionFailed', 'goToPanel'] as const;

describe('057 attention theme tokens', () => {
  const themes = Object.entries(ALL_DEFAULT_THEMES);

  it.each(themes)('%s carries the mark colour as a hex value', (_name, theme) => {
    expect((theme.colours as Record<string, string>).attentionMark).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('the mark colour has editor copy', () => {
    expect(THEME_TOKEN_COPY['colours.attentionMark']?.label).toBeTruthy();
    expect(THEME_TOKEN_COPY['colours.attentionMark']?.description).toBeTruthy();
  });

  it('retires attentionFailedMark (FR-139): in no theme, no editor copy, a stray key dropped on load', () => {
    expect((THRONG_THEME.colours as Record<string, string>).attentionFailedMark).toBeUndefined();
    for (const [, theme] of themes) {
      expect((theme.colours as Record<string, string>).attentionFailedMark).toBeUndefined();
    }
    expect(THEME_TOKEN_COPY['colours.attentionFailedMark']).toBeUndefined();
    const stray = { ...THRONG_THEME, colours: { ...THRONG_THEME.colours, attentionFailedMark: '#ff0000' } };
    expect((migrateTheme(stray).colours as Record<string, string>).attentionFailedMark).toBeUndefined();
  });

  it.each(RETIRED_ICONS)('retires the %s glyph (FR-124, FR-139): no glyph, no editor copy, a stray key dropped on load', (token) => {
    expect((THRONG_THEME.icons as Record<string, string>)[token]).toBeUndefined();
    for (const [, theme] of themes) expect((theme.icons as Record<string, string>)[token]).toBeUndefined();
    expect(THEME_TOKEN_COPY[`icons.${token}`]).toBeUndefined();
    const stray = { ...THRONG_THEME, icons: { ...THRONG_THEME.icons, [token]: '⚑' } };
    expect((migrateTheme(stray).icons as Record<string, string>)[token]).toBeUndefined();
  });

  it.each(themes)('%s emits a number colour for the circle that is the black or white its fill needs (FR-136)', (_name, theme) => {
    const vars = toCssVariables(theme);
    const fill = vars['--throng-colour-attentionMark']!;
    const text = vars['--throng-attention-mark-text'];
    expect(text).toBe(readableTextOn(fill) ?? '#000000');
    expect(contrastRatio(fill, text!)).toBeGreaterThanOrEqual(3);
  });

  it('a user theme with its own mark colour gets the number colour that fill needs', () => {
    const white = toCssVariables({ ...THRONG_THEME, colours: { ...THRONG_THEME.colours, attentionMark: '#ffffff' } });
    const black = toCssVariables({ ...THRONG_THEME, colours: { ...THRONG_THEME.colours, attentionMark: '#000000' } });
    expect(white['--throng-attention-mark-text']).toBe('#000000');
    expect(black['--throng-attention-mark-text']).toBe('#ffffff');
  });

  it('bumps the shipped-defaults version so existing installs receive the tokens', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(29);
  });
});
