/**
 * 075 FR-072, SC-013 — the print palette: a value for every colour token a theme emits, independent of the Light
 * theme it was seeded from, and readable on paper.
 */
import { describe, expect, it } from 'vitest';
import { PRINT_PALETTE, printPaletteCss } from '../../src/preview/print-palette.js';
import { DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME, toCssVariables } from '../../src/config/theme.js';
import { contrastRatio } from '../../src/config/colour-math.js';
import { calloutContrastFailures } from '../../src/config/callout-colours.js';

describe('the print palette (FR-072)', () => {
  it('has a value for every colour token a theme emits', () => {
    const emitted = Object.keys(toCssVariables(THRONG_THEME))
      .filter((k) => k.startsWith('--throng-colour-'))
      .map((k) => k.slice('--throng-colour-'.length));
    expect(emitted.filter((token) => PRINT_PALETTE[token] === undefined)).toEqual([]);
  });

  it('is its own object, not the Light theme, and cannot be changed', () => {
    expect(PRINT_PALETTE).not.toBe(DEFAULT_THEMES.Light!.colours);
    expect(Object.isFrozen(PRINT_PALETTE)).toBe(true);
    const light = DEFAULT_THEMES.Light!.colours as Record<string, string>;
    const before = PRINT_PALETTE.text;
    const original = light.text;
    light.text = '#ff00ff';
    try {
      expect(PRINT_PALETTE.text).toBe(before);
    } finally {
      light.text = original!;
    }
  });

  it('prints body text, code and the error colour readably on the page', () => {
    const page = PRINT_PALETTE.editorBg!;
    for (const token of ['text', 'editorFg', 'textMuted', 'syntaxKeyword', 'syntaxString', 'syntaxComment', 'syntaxInvalid', 'accent']) {
      expect(contrastRatio(PRINT_PALETTE[token]!, page), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('passes the callout contrast guard (SC-013)', () => {
    expect(calloutContrastFailures({ colours: PRINT_PALETTE })).toEqual([]);
  });

  it('writes every value as a custom property', () => {
    const css = printPaletteCss();
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).toContain(`--throng-colour-calloutInfo: ${PRINT_PALETTE.calloutInfo};`);
  });
});
