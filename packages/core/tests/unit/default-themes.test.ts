import { describe, it, expect } from 'vitest';
import { DEFAULT_THEMES, ALL_DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME } from '../../src/config/theme.js';

const EXPECTED = [
  'Light',
  'Snake',
  'Gothic',
  'Windows Terminal',
  'Bash',
  'SUBNET',
  'VSCode',
  'VI-VIM',
  'English Garden',
  'Matrix',
  'Cyberpunk',
  'Claude',
  'Debian',
  'Ubuntu',
];

const COLOUR_TOKENS = Object.keys(THRONG_THEME.colours);
const ICON_TOKENS = Object.keys(THRONG_THEME.icons);

describe('DEFAULT_THEMES (FR-044/046, SC-007)', () => {
  it('ships exactly the 14 named default themes', () => {
    expect(Object.keys(DEFAULT_THEMES).sort()).toEqual([...EXPECTED].sort());
  });

  it('every theme name matches its record key and is unique', () => {
    const names = Object.entries(DEFAULT_THEMES).map(([key, theme]) => {
      expect(theme.name).toBe(key);
      return theme.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  it('every theme styles the full colour + icon token set (FR-046)', () => {
    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      for (const token of COLOUR_TOKENS) {
        expect(theme.colours[token], `${name}.colours.${token}`).toBeTruthy();
      }
      for (const token of ICON_TOKENS) {
        expect(theme.icons[token], `${name}.icons.${token}`).toBeTruthy();
      }
      expect(theme.fonts.family.length).toBeGreaterThan(0);
    }
  });

  it('every default theme populates the button style tokens (H5, FR-046a)', () => {
    for (const [name, theme] of Object.entries(DEFAULT_THEMES)) {
      for (const token of ['buttonBg', 'buttonText', 'buttonHoverBg', 'buttonHoverText']) {
        expect(theme.colours[token], `${name}.colours.${token}`).toBeTruthy();
      }
      expect(theme.typography?.button, `${name}.typography.button`).toBeDefined();
    }
  });

  it('themes are pairwise-distinct by their colour palette (not merely vs throng)', () => {
    const themes = Object.values(ALL_DEFAULT_THEMES); // includes throng
    for (let i = 0; i < themes.length; i += 1) {
      for (let j = i + 1; j < themes.length; j += 1) {
        expect(
          JSON.stringify(themes[i].colours),
          `${themes[i].name} vs ${themes[j].name}`,
        ).not.toBe(JSON.stringify(themes[j].colours));
      }
    }
  });

  it('ALL_DEFAULT_THEMES includes throng plus the 14', () => {
    expect(Object.keys(ALL_DEFAULT_THEMES)).toContain('throng');
    expect(Object.keys(ALL_DEFAULT_THEMES)).toHaveLength(15);
  });
});

import {
  hexToRgb,
  contrastRatio,
  relativeLuminance,
  assertDistinct,
  assertInScopeContrast,
} from '../../src/config/theme-quality.js';

/** HSL hue (degrees) of a hex colour; NaN for greys. */
function hueOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d < 0.08) return NaN; // near-grey → no meaningful hue
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe('editor gutter tokens (009, US3/FR-010/012)', () => {
  it('every bundled theme supplies both gutter tokens', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      expect(theme.colours.editorGutterBg, `${name}.editorGutterBg`).toBeTruthy();
      expect(theme.colours.editorGutterFg, `${name}.editorGutterFg`).toBeTruthy();
    }
  });

  it('gutter background is a visible but subtle offset from the editor body', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const bg = theme.colours.editorBg;
      const gutter = theme.colours.editorGutterBg;
      expect(gutter, `${name} gutter equals editor body`).not.toBe(bg);
      const dl = Math.abs(
        relativeLuminance(hexToRgb(bg)) - relativeLuminance(hexToRgb(gutter)),
      );
      expect(dl, `${name} gutter offset too large`).toBeLessThan(0.25); // subtle, not a slab
    }
  });

  it('default gutter text meets the 3:1 pairing on the gutter background', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      const ratio = contrastRatio(theme.colours.editorGutterFg, theme.colours.editorGutterBg);
      expect(ratio, `${name} gutter text on gutter background`).toBeGreaterThanOrEqual(3.0);
    }
  });
});

describe('Bash is multi-hue and distinct from Matrix (009, US1/FR-001)', () => {
  it('Bash spans green, teal, cyan, yellow and magenta', () => {
    const hues = Object.values(ALL_DEFAULT_THEMES.Bash.colours)
      .map(hueOf)
      .filter((h) => !Number.isNaN(h));
    const inRange = (lo: number, hi: number): boolean => hues.some((h) => h >= lo && h < hi);
    expect(inRange(90, 165), 'green').toBe(true);
    expect(inRange(165, 185), 'teal').toBe(true);
    expect(inRange(185, 210), 'cyan').toBe(true);
    expect(inRange(35, 70), 'yellow').toBe(true);
    expect(inRange(285, 330), 'magenta').toBe(true);
  });

  it('Matrix keeps its mono-green identity (text/accent/terminal/editor all green)', () => {
    const c = ALL_DEFAULT_THEMES.Matrix.colours;
    // The identity tokens that define the Matrix look are all in the green band;
    // semantic tokens (danger/unsaved) may legitimately differ.
    for (const token of ['text', 'accent', 'terminalFg', 'editorFg']) {
      const h = hueOf(c[token]);
      expect(h, `Matrix ${token} hue ${h}`).toBeGreaterThanOrEqual(90);
      expect(h, `Matrix ${token} hue ${h}`).toBeLessThan(165);
    }
  });
});

describe('brand palettes (009, US4/US5)', () => {
  it('SUBNET uses Deep Space Blue as its base and both neon accents', () => {
    const c = ALL_DEFAULT_THEMES.SUBNET.colours;
    expect(c.appBg).toBe('#001B40');
    expect(c.terminalBg).toBe('#001B40');
    expect(c.editorBg).toBe('#001B40');
    expect(c.accent).toBe('#39FF14'); // Neon Core Green — active states
    expect(c.editorCursor).toBe('#00EFFF'); // Neon Cyan — second accent
    expect(c.border).toBe('#4C4C4C'); // Gunmetal Grey — chrome
  });

  it('Cyberpunk derives from its reference palette on a near-black base', () => {
    const c = ALL_DEFAULT_THEMES.Cyberpunk.colours;
    expect(c.appBg).toBe('#000000');
    expect(c.danger).toBe('#c5003c'); // crimson
    expect(c.border).toBe('#880425'); // deep maroon
    expect(c.unsavedDot).toBe('#f3e600'); // bright yellow
    expect(c.accent).toBe('#55ead4'); // pale teal
  });
});

describe('theme-quality guards hold for the shipped set (009, US6)', () => {
  const themes = Object.values(ALL_DEFAULT_THEMES);
  it('all shipped themes pass the distinctness gate', () => {
    expect(() => assertDistinct(themes)).not.toThrow();
  });
  it('Bash, SUBNET and Cyberpunk pass WCAG 2.1 AA contrast', () => {
    expect(() => assertInScopeContrast(themes)).not.toThrow();
  });
  it('ships the dismiss icon token distinct from destroy (009 addition)', () => {
    for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
      expect(theme.icons.dismiss, `${name}.icons.dismiss`).toBeTruthy();
    }
    expect(THRONG_THEME.icons.dismiss).toBe('✕');
  });
});
