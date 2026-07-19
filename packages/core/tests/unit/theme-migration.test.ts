import { describe, it, expect } from 'vitest';
import { migrateTheme, THRONG_THEME, type Theme } from '../../src/index.js';

const REMOVED = ['menuSurface', 'dialogSurface', 'buttonBg', 'buttonText', 'buttonHoverBg', 'buttonHoverText'];
const BUTTON_TYPES = ['confirm', 'cancel', 'destroy'] as const;
const BUTTON_VARIANTS = ['Bg', 'HoverBg', 'Border', 'HoverBorder', 'Text', 'HoverText'] as const;
const BUTTON_TOKENS = BUTTON_TYPES.flatMap((t) => BUTTON_VARIANTS.map((v) => `${t}Button${v}`));

/** A theme authored BEFORE the 021 refactor: legacy button pair + the removed surfaces, no typed buttons. */
function legacyTheme(): Theme {
  return {
    name: 'Legacy',
    colours: {
      accent: '#111111',
      accentText: '#222222',
      danger: '#aa0000',
      dangerText: '#ffeeee',
      surface: '#333333',
      surfaceActive: '#444444',
      text: '#eeeeee',
      border: '#555555',
      // legacy button tokens the migration must snapshot before dropping:
      buttonBg: '#0a0a0a',
      buttonHoverBg: '#0b0b0b',
      buttonText: '#0c0c0c',
      buttonHoverText: '#0d0d0d',
      // removed surfaces:
      menuSurface: '#0e0e0e',
      dialogSurface: '#0f0f0f',
    },
    fonts: THRONG_THEME.fonts,
    icons: {},
  };
}

describe('migrateTheme (021, FR-031/032)', () => {
  it('drops the six removed colour keys', () => {
    const out = migrateTheme(legacyTheme());
    for (const k of REMOVED) expect(out.colours[k], k).toBeUndefined();
  });

  it('seeds all 18 typed button tokens by derivation', () => {
    const out = migrateTheme(legacyTheme());
    for (const token of BUTTON_TOKENS) expect(out.colours[token], token).toBeTruthy();
    // Confirm ← accent / accentText
    expect(out.colours.confirmButtonBg).toBe('#111111');
    expect(out.colours.confirmButtonHoverBg).toBe('#111111');
    expect(out.colours.confirmButtonBorder).toBe('#111111');
    expect(out.colours.confirmButtonHoverBorder).toBe('#111111');
    expect(out.colours.confirmButtonText).toBe('#222222');
    expect(out.colours.confirmButtonHoverText).toBe('#222222');
    // Destroy ← danger / dangerText
    expect(out.colours.destroyButtonBg).toBe('#aa0000');
    expect(out.colours.destroyButtonText).toBe('#ffeeee');
    // Cancel borders ← border
    expect(out.colours.cancelButtonBorder).toBe('#555555');
    expect(out.colours.cancelButtonHoverBorder).toBe('#555555');
  });

  it('(F1) derive-before-drop: Cancel takes the LEGACY button values, not the fallbacks', () => {
    const out = migrateTheme(legacyTheme());
    expect(out.colours.cancelButtonBg).toBe('#0a0a0a'); // legacy buttonBg, NOT surface (#333333)
    expect(out.colours.cancelButtonHoverBg).toBe('#0b0b0b'); // legacy buttonHoverBg, NOT surfaceActive
    expect(out.colours.cancelButtonText).toBe('#0c0c0c'); // legacy buttonText, NOT text
    expect(out.colours.cancelButtonHoverText).toBe('#0d0d0d'); // legacy buttonHoverText, NOT text
  });

  it('falls back to surface/surfaceActive/text when NO legacy button tokens are present', () => {
    const noLegacy = legacyTheme();
    for (const k of ['buttonBg', 'buttonHoverBg', 'buttonText', 'buttonHoverText']) delete noLegacy.colours[k];
    const out = migrateTheme(noLegacy);
    expect(out.colours.cancelButtonBg).toBe('#333333'); // surface
    expect(out.colours.cancelButtonHoverBg).toBe('#444444'); // surfaceActive
    expect(out.colours.cancelButtonText).toBe('#eeeeee'); // text
    expect(out.colours.cancelButtonHoverText).toBe('#eeeeee'); // text
  });

  it('is idempotent', () => {
    const once = migrateTheme(legacyTheme());
    const twice = migrateTheme(once);
    expect(twice).toEqual(once);
  });

  it('is lossless: every surviving token keeps its exact value', () => {
    const legacy = legacyTheme();
    const out = migrateTheme(legacy);
    for (const [k, v] of Object.entries(legacy.colours)) {
      if (REMOVED.includes(k)) continue;
      expect(out.colours[k], k).toBe(v);
    }
  });

  it('does not seed a token that is already present (explicit author value wins)', () => {
    const withOne = legacyTheme();
    withOne.colours.confirmButtonBg = '#abcdef';
    const out = migrateTheme(withOne);
    expect(out.colours.confirmButtonBg).toBe('#abcdef');
  });
});
