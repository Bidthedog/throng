/**
 * A rename to a name Windows cannot hold is refused with a plain reason, before the file system is asked.
 *
 * Asked anyway, `a<b` came back as a raw errno notice, and `report.` was quietly stored as `report` — so the renamed
 * row was never re-selected and the undo entry named a file that did not exist.
 */
import { describe, expect, it, vi } from 'vitest';
import { withHostTraits } from '@throng/core/testing';
import { FilesService } from '../../src/main/files-service.js';

function serviceOver(root: string, names: string[]) {
  const present = new Set(names.map((n) => `${root}/${n}`));
  const rename = vi.fn(async (abs: string, name: string) => `${abs.slice(0, abs.lastIndexOf('/'))}/${name}`);
  const fs = { realpath: async (p: string) => p, exists: async (p: string) => present.has(p), rename };
  const files = new FilesService(fs as unknown as ConstructorParameters<typeof FilesService>[0], {} as ConstructorParameters<typeof FilesService>[1]);
  files.setRoot(root);
  return { files, rename };
}

describe.skipIf(process.platform === 'win32')('renaming under Windows path rules', () => {
  it.each([
    ['a<b.txt', 'characters'],
    ['what?.txt', 'characters'],
    ['report.', 'end with'],
    ['CON', 'reserves'],
    ['nul.txt', 'reserves'],
    ['..', 'Invalid name'],
  ])('refuses %j, naming why, and renames nothing', async (name, reason) => {
    const { files, rename } = serviceOver('C:/proj', ['a.txt']);
    const result = await withHostTraits('windows', () => files.rename('a.txt', name));
    expect(result).toMatchObject({ error: expect.stringContaining(reason) });
    expect(rename).not.toHaveBeenCalled();
  });

  it('still renames to an ordinary name', async () => {
    const { files, rename } = serviceOver('C:/proj', ['a.txt']);
    const result = await withHostTraits('windows', () => files.rename('a.txt', 'console.log.txt'));
    expect(result).toEqual({ ok: true });
    expect(rename).toHaveBeenCalledOnce();
  });
});

describe.skipIf(process.platform === 'win32')('renaming under Linux path rules', () => {
  it('allows what Linux allows: a colon, a trailing dot, a device name', async () => {
    for (const name of ['a:b', 'report.', 'CON']) {
      const { files, rename } = serviceOver('/home/dev/proj', ['a.txt']);
      expect(await withHostTraits('linux', () => files.rename('a.txt', name))).toEqual({ ok: true });
      expect(rename).toHaveBeenCalledOnce();
    }
  });
});
