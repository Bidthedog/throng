/**
 * 070 T067 (FR-020): a case-only rename on macOS asks the HOST's path rules whether the destination is the item itself.
 *
 * Those rules are per volume — a `caseSensitiveRoots` entry keeps case below it — so the question must be asked of the
 * full paths, which a root can match, not of bare leaves, which none can. Asked of leaves, every macOS volume read as
 * case-insensitive: renaming `readme.md` to `README.md` beside an existing `README.md` on a case-sensitive volume
 * skipped the existence check, and the rename replaced the sibling. The real case-only rename on Windows' and Linux's
 * file systems is `rename-case-only.integration.test.ts`; this is the decision, over a fake file system.
 *
 * Skipped on a Windows host: `files-service.ts` builds paths with the host's `node:path`, which joins macOS paths with
 * backslashes there; macOS and Linux both join with `/`, which is what a Mac runs.
 */
import { describe, expect, it, vi } from 'vitest';
import { macosHostTraits } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import { FilesService } from '../../src/main/files-service.js';

const SENSITIVE = '/Volumes/Work';

function serviceOver(root: string, names: string[]) {
  const present = new Set(names.map((n) => `${root}/${n}`));
  const rename = vi.fn(async (abs: string, name: string) => `${abs.slice(0, abs.lastIndexOf('/'))}/${name}`);
  const fs = {
    realpath: async (p: string) => p,
    exists: async (p: string) => present.has(p),
    rename,
  };
  const files = new FilesService(fs as unknown as ConstructorParameters<typeof FilesService>[0], {} as ConstructorParameters<typeof FilesService>[1]);
  files.setRoot(root);
  return { files, rename };
}

describe.skipIf(process.platform === 'win32')('a case-only rename under macOS path rules', () => {
  const traits = macosHostTraits('/tmp/throng-ipc', [SENSITIVE]);

  it('is refused on a case-sensitive volume when a sibling already has the new name, so nothing is replaced', async () => {
    const { files, rename } = serviceOver(`${SENSITIVE}/proj`, ['readme.md', 'README.md']);
    const result = await withHostTraits(traits, () => files.rename('readme.md', 'README.md'));
    expect(result).toEqual({ error: 'A file or folder with this name already exists.' });
    expect(rename).not.toHaveBeenCalled();
  });

  it('still renames a lone file on a case-insensitive volume, where the destination is the item itself', async () => {
    const { files, rename } = serviceOver('/Users/dev/proj', ['readme.md']);
    // APFS answers `exists` case-insensitively, so the destination "exists": it is this file.
    const present = new Set(['/Users/dev/proj/readme.md', '/Users/dev/proj/README.md']);
    (files as unknown as { fs: { exists: (p: string) => Promise<boolean> } }).fs.exists = async (p) => present.has(p);
    const result = await withHostTraits(traits, () => files.rename('readme.md', 'README.md'));
    expect(result).toEqual({ ok: true });
    expect(rename).toHaveBeenCalledExactlyOnceWith('/Users/dev/proj/readme.md', 'README.md');
  });
});
