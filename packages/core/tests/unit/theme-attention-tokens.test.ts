import { describe, expect, it } from 'vitest';
import { ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';
import { THRONG_THEME } from '../../src/config/theme.js';
import { migrateTheme } from '../../src/config/theme-ops.js';

/**
 * 057 (research R11) — two colour tokens and three icon tokens for terminal attention marks.
 * `attentionMark` / `attentionFailedMark` are deliberately two colours: a Failed mark has to be
 * distinguishable from an Attention mark by more than its glyph (FR-016).
 *
 * Layer: unit — pure data over the bundled themes.
 */
const COLOURS = ['attentionMark', 'attentionFailedMark'] as const;
const ICONS = ['attention', 'attentionFailed'] as const;

describe('057 attention theme tokens', () => {
  const themes = Object.entries(ALL_DEFAULT_THEMES);

  it.each(themes)('%s carries both mark colours as hex values', (_name, theme) => {
    const colours = theme.colours as Record<string, string>;
    for (const token of COLOURS) expect(colours[token]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(themes)('%s paints a Failed mark differently from an Attention mark', (_name, theme) => {
    const colours = theme.colours as Record<string, string>;
    expect(colours.attentionMark!.toLowerCase()).not.toBe(colours.attentionFailedMark!.toLowerCase());
  });

  it.each(themes)('%s carries the two icon tokens', (_name, theme) => {
    const icons = theme.icons as Record<string, string>;
    for (const token of ICONS) {
      expect(typeof icons[token]).toBe('string');
      expect(icons[token]!.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ...COLOURS.map((t) => `colours.${t}`),
    ...ICONS.map((t) => `icons.${t}`),
  ])('%s has editor copy', (key) => {
    const copy = THEME_TOKEN_COPY[key];
    expect(copy?.label).toBeTruthy();
    expect(copy?.description).toBeTruthy();
  });

  it('retires goToPanel (FR-124: the toast card is the link): no glyph, no editor copy, a stray key dropped on load', () => {
    expect((THRONG_THEME.icons as Record<string, string>).goToPanel).toBeUndefined();
    expect(THEME_TOKEN_COPY['icons.goToPanel']).toBeUndefined();
    const stray = { ...THRONG_THEME, icons: { ...THRONG_THEME.icons, goToPanel: '↗' } };
    expect((migrateTheme(stray).icons as Record<string, string>).goToPanel).toBeUndefined();
  });

  it('bumps the shipped-defaults version so existing installs receive the tokens', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(24);
  });
});
