import { describe, expect, it } from 'vitest';
import type { WriteOutcome } from '@throng/core';
import { retargetThemesIconSet, type ThemeDocuments } from '../../src/main/icon-set-themes.js';

/**
 * Spec 069 FR-042, FR-043 — a renamed set takes the themes using it along; a deleted one returns them to
 * the default set. Only `iconPack` changes; every other key is written back as it was read.
 */
function store(files: Record<string, string>, fail: string[] = []): ThemeDocuments & { files: Record<string, string> } {
  return {
    files,
    listThemes: async () => Object.keys(files).sort(),
    readRaw: async ({ name }) => files[name] ?? '',
    write: async ({ name }, value): Promise<WriteOutcome> => {
      if (fail.includes(name)) return { ok: false, error: 'locked' };
      files[name] = JSON.stringify(value);
      return { ok: true };
    },
  };
}

describe('retargetThemesIconSet', () => {
  it('points every theme naming the old set at the new one, and only those', async () => {
    const s = store({
      Dark: JSON.stringify({ name: 'Dark', iconPack: 'mine', colours: { bg: '#000' } }),
      Light: JSON.stringify({ name: 'Light', iconPack: 'other' }),
      Plain: JSON.stringify({ name: 'Plain' }),
    });
    expect(await retargetThemesIconSet(s, 'mine', 'ours')).toEqual(['Dark']);
    expect(JSON.parse(s.files.Dark)).toEqual({ name: 'Dark', iconPack: 'ours', colours: { bg: '#000' } });
    expect(JSON.parse(s.files.Light).iconPack).toBe('other');
    expect(JSON.parse(s.files.Plain)).toEqual({ name: 'Plain' });
  });

  it('removes the key for a deleted set, which is what selecting the default set writes', async () => {
    const s = store({ Dark: JSON.stringify({ name: 'Dark', iconPack: 'mine' }) });
    expect(await retargetThemesIconSet(s, 'mine', undefined)).toEqual(['Dark']);
    expect(JSON.parse(s.files.Dark)).toEqual({ name: 'Dark' });
  });

  it('matches the set name exactly: a theme naming it in another case is a different set', async () => {
    const s = store({ Dark: JSON.stringify({ name: 'Dark', iconPack: 'Mine' }) });
    expect(await retargetThemesIconSet(s, 'mine', 'ours')).toEqual([]);
  });

  it('skips a theme that does not parse and one whose write fails, and carries on', async () => {
    const s = store(
      {
        Broken: '{ not json',
        Dark: JSON.stringify({ iconPack: 'mine' }),
        Locked: JSON.stringify({ iconPack: 'mine' }),
      },
      ['Locked'],
    );
    expect(await retargetThemesIconSet(s, 'mine', 'ours')).toEqual(['Dark']);
    expect(s.files.Broken).toBe('{ not json');
  });
});
