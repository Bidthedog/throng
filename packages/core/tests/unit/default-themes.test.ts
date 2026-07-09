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
