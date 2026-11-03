import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';
import { FileConfigStore } from '../../../ui/src/main/config-store.js';
import { NodeFileSystem } from '../../../ui/src/main/node-file-system.js';

/**
 * Layer: integration. Mode bits, symlinks and bytes that are not UTF-8 are facts only a real ext4 keeps (062 FR-020,
 * FR-023). The string rules for the same names are in the core path tests; these prove the disk agrees.
 */
describe.skipIf(skipUnlessLinux('POSIX file modes, symlinks and byte names'))('files on a Linux filesystem (062 US3)', () => {
  let root: string;
  const fs = new NodeFileSystem();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'throng-linux-files-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('an editor save keeps the mode bits, and writes through a symlink', async () => {
    const file = join(root, 'run.sh');
    const link = join(root, 'link.sh');
    writeFileSync(file, 'one');
    chmodSync(file, 0o750);
    symlinkSync(file, link);
    await fs.writeBytes(link, new TextEncoder().encode('two'));
    expect(readFileSync(file, 'utf8')).toBe('two');
    expect(statSync(file).mode & 0o777).toBe(0o750);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('a settings file kept elsewhere through a symlink stays a symlink, and keeps its mode', async () => {
    const dotfiles = join(root, 'dotfiles');
    const config = join(root, 'config');
    mkdirSync(dotfiles);
    mkdirSync(config);
    const real = join(dotfiles, 'settings.json');
    const link = join(config, 'settings.json');
    writeFileSync(real, '{}');
    chmodSync(real, 0o640);
    symlinkSync(real, link);

    const outcome = await new FileConfigStore(config).write({ kind: 'settings' }, { version: 1 });
    expect(outcome.ok).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(real);
    expect(JSON.parse(readFileSync(real, 'utf8'))).toMatchObject({ version: 1 });
    expect(statSync(real).mode & 0o777).toBe(0o640);
  });

  it('a reset through the same symlink leaves it a symlink too', async () => {
    const real = join(root, 'real.json');
    const link = join(root, 'link.json');
    writeFileSync(real, '{}');
    chmodSync(real, 0o640);
    symlinkSync(real, link);
    const result = await new FileConfigStore(root).writeFilesAtomic([{ path: link, content: '{"a":1}' }]);
    expect(result.ok).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('{"a":1}');
    expect(statSync(real).mode & 0o777).toBe(0o640);
  });

  it('two names differing only by case are two files', async () => {
    writeFileSync(join(root, 'README.md'), 'upper');
    writeFileSync(join(root, 'readme.md'), 'lower');
    const names = (await fs.list(root)).map((e) => e.name).sort();
    expect(names).toEqual(['README.md', 'readme.md']);
  });

  it('a backslash and a trailing dot are ordinary characters in a name', async () => {
    writeFileSync(join(root, 'a\\b.txt'), 'x');
    writeFileSync(join(root, 'trailing.'), 'y');
    const names = (await fs.list(root)).map((e) => e.name).sort();
    expect(names).toEqual(['a\\b.txt', 'trailing.']);
  });

  it('a symlink cycle is listed, not followed for ever', async () => {
    const dir = join(root, 'dir');
    mkdirSync(dir);
    symlinkSync(root, join(dir, 'back'));
    const names = (await fs.list(dir)).map((e) => e.name);
    expect(names).toEqual(['back']);
  });

  it('deleting a symlink deletes the link, and never what it points at', async () => {
    const target = join(root, 'keep');
    mkdirSync(target);
    writeFileSync(join(target, 'inside.txt'), 'kept');
    const link = join(root, 'link');
    symlinkSync(target, link);
    await fs.delete(link);
    expect(() => lstatSync(link)).toThrow();
    expect(readFileSync(join(target, 'inside.txt'), 'utf8')).toBe('kept');
  });
});
