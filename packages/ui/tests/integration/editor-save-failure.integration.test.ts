/**
 * A save that fails part-way through its write leaves the file exactly as it was (#706).
 *
 * Layer: integration — the defect is in how the real `NodeFileSystem` puts bytes on disk under the
 * real `EditorService.save`; only real files show the original surviving (or not) a failed write.
 *
 * ══ WHAT THE USER SEES ══
 *
 * The disk fills (ENOSPC) or a network share drops (EIO) while the editor is saving. The editor says
 * the save failed — and the file on disk is now truncated or empty, because the save opened it with
 * truncate and wrote in place. Nothing of the previous content survived.
 *
 * ══ HOW THE FAILURE IS FORCED ══
 *
 * A real full disk needs a size-limited mount the test cannot create unprivileged. Instead
 * `writeFile` behaves as a full disk does: it really writes the first half of the bytes to the path
 * it was given, then rejects with a genuine-shaped ENOSPC. Whatever path the save chose to write
 * to is the one that ends up half-written.
 */
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { skipOnWindows } from '@throng/core/testing';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';

/** While set, every `writeFile` writes half its bytes and then fails as a full disk does. */
const disk = vi.hoisted(() => ({ full: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const writeFile = async (...args: Parameters<typeof actual.writeFile>): Promise<void> => {
    if (!disk.full) return actual.writeFile(...args);
    const [path, data] = args;
    const all = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data as Uint8Array);
    await actual.writeFile(path, all.subarray(0, Math.floor(all.length / 2)));
    throw Object.assign(new Error(`ENOSPC: no space left on device, write`), {
      code: 'ENOSPC',
      errno: -28,
      syscall: 'write',
    });
  };
  return { ...actual, writeFile, default: { ...actual, writeFile } };
});

const fs = new NodeFileSystem(async () => {});
const svc = new EditorService(fs, () => DEFAULT_APP_SETTINGS);

const ORIGINAL = 'the content that was on disk before the save\n'.repeat(40);
const EDITED = `${ORIGINAL}a pasted block that does not fit\n`.repeat(2);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-save-fail-'));
});
afterEach(async () => {
  disk.full = false;
  await rm(root, { recursive: true, force: true });
});

function save(absPath: string, text: string) {
  return svc.save({
    absPath,
    text,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
    ownerKind: 'project',
    ownerRoot: root,
    allProjectRoots: [root],
  });
}

describe('editor save atomicity (#706)', () => {
  it('a save that fails mid-write leaves the original file intact', async () => {
    const file = join(root, 'notes.txt');
    await writeFile(file, ORIGINAL);

    disk.full = true;
    const result = await save(file, EDITED);
    disk.full = false;

    expect(result.ok).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(ORIGINAL);
    // The half-written staging file is not left behind in the user's folder.
    expect(await readdir(root)).toEqual(['notes.txt']);
  });

  it('a save through a symlink replaces the link target and keeps the link', async () => {
    const real = join(root, 'real.txt');
    const link = join(root, 'link.txt');
    await writeFile(real, ORIGINAL);
    await symlink(real, link);

    const result = await save(link, EDITED);

    expect(result.ok).toBe(true);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(real);
    expect(await readFile(real, 'utf8')).toBe(EDITED);
  });

  it.skipIf(skipOnWindows('Windows has no POSIX mode bits to keep'))('a save keeps the file mode', async () => {
    const file = join(root, 'script.sh');
    await writeFile(file, ORIGINAL);
    await chmod(file, 0o751);

    const result = await save(file, EDITED);

    expect(result.ok).toBe(true);
    expect((await stat(file)).mode & 0o7777).toBe(0o751);
    expect(await readFile(file, 'utf8')).toBe(EDITED);
  });

  // Root ignores folder permissions, so the refusal this needs cannot be arranged as root.
  it.skipIf(skipOnWindows('a read-only POSIX folder is the refusal; Windows folders have no such mode') || process.getuid?.() === 0)(
    'a writable file in a folder that refuses new files still saves',
    async () => {
      const folder = join(root, 'locked');
      await mkdir(folder);
      const file = join(folder, 'notes.txt');
      await writeFile(file, ORIGINAL);
      await chmod(folder, 0o555);
      try {
        const result = await save(file, EDITED);

        expect(result.ok).toBe(true);
        expect(await readFile(file, 'utf8')).toBe(EDITED);
      } finally {
        await chmod(folder, 0o755);
      }
    },
  );
});
