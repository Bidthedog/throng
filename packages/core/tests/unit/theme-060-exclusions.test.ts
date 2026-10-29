import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '../../src/config/theme.js';
import { THEME_TOKEN_COPY } from '../../src/config/theme-copy.js';
import { SHIPPED_DEFAULTS_VERSION } from '../../src/config/shipped-defaults.js';

/**
 * 060 #532 T047 (FR-037, FR-038, research R24) — two icon tokens.
 *
 * `projectSettings` is the File Explorer's project settings control, which drew the app's
 * Preferences `settings` ⚙ — two different dialogs behind one glyph. `searchExclusions` is the Find in
 * Files panel's exclusions toggle.
 */
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;
const TOKENS = ['projectSettings', 'searchExclusions'] as const;

describe('060 #532 icon tokens', () => {
  it.each(TOKENS)('%s ships a plain glyph and editor copy', (token) => {
    const glyph = (THRONG_THEME.icons as Record<string, string>)[token];
    expect(glyph, token).toBeTruthy();
    expect(PICTOGRAPHIC.test(glyph!), `${token} = ${glyph}`).toBe(false);
    const copy = THEME_TOKEN_COPY[`icons.${token}`];
    expect(copy?.label).toBeTruthy();
    expect(copy?.description).toBeTruthy();
  });

  it('draws the project settings control as ⌂, not the Preferences cog (FR-037)', () => {
    expect(THRONG_THEME.icons.projectSettings).toBe('⌂');
    expect(THRONG_THEME.icons.projectSettings).not.toBe(THRONG_THEME.icons.settings);
  });

  it('draws the exclusions toggle as ⊝, a glyph no other token uses (FR-038)', () => {
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(icons.searchExclusions).toBe('⊝');
    const others = Object.entries(icons).filter(([k, v]) => k !== 'searchExclusions' && v === '⊝');
    expect(others).toEqual([]);
  });

  it('bumps the shipped-defaults version so existing installs receive them', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(27);
  });
});
