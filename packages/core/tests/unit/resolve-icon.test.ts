import { describe, expect, it } from 'vitest';
import { DEFAULT_ICON_SET, ICON_KEYS, resolveIcon, type UserIconSetDto } from '../../src/index.js';

/** Spec 069 FR-013 to FR-016, FR-034: which markup an icon draws. */
const MINE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>';

function set(over: Partial<UserIconSetDto> & { name: string }): UserIconSetDto {
  return { overrides: {}, failures: {}, unrecognised: [], ...over };
}

describe('resolveIcon (069)', () => {
  const mine = set({ name: 'mine', overrides: { save: MINE } });

  it('draws the selected user set’s override for a key it overrides (FR-013)', () => {
    expect(resolveIcon({ iconPack: 'mine' }, [mine], 'save')).toBe(MINE);
  });

  it('draws the default set for every key the selected set does not override (FR-015)', () => {
    expect(resolveIcon({ iconPack: 'mine' }, [mine], 'saveAs')).toBe(DEFAULT_ICON_SET.saveAs);
  });

  it.each([
    ['no set selected', {}],
    ['the default set selected', { iconPack: 'throng' }],
    ['a set that is not listed', { iconPack: 'gone' }],
  ])('draws the default set with %s (FR-013, FR-014)', (_label, theme) => {
    expect(resolveIcon(theme, [mine], 'save')).toBe(DEFAULT_ICON_SET.save);
  });

  it('draws the default set when the selected set could not be loaded (FR-016)', () => {
    const broken = set({ name: 'broken', overrides: { save: MINE }, error: 'The folder is gone.' });
    expect(resolveIcon({ iconPack: 'broken' }, [broken], 'save')).toBe(DEFAULT_ICON_SET.save);
  });

  it('lets an override win whatever the default set holds, and gives every other key the current default (FR-034)', () => {
    for (const key of ICON_KEYS) {
      const expected = key === 'save' ? MINE : DEFAULT_ICON_SET[key];
      expect(resolveIcon({ iconPack: 'mine' }, [mine], key), key).toBe(expected);
    }
  });

  it('always returns drawable markup', () => {
    for (const key of ICON_KEYS) expect(resolveIcon({}, [], key)).toMatch(/^<svg[\s>]/);
  });
});
