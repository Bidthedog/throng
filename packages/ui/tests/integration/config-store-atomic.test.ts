import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../src/main/config-store.js';

/**
 * Transactional multi-file write (010, FR-012/012a): all-or-nothing with rollback.
 * The realistic failure is a locked/unwritable target on Windows; we simulate it
 * by pre-creating the target path as a directory so the commit rename fails.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-atomic-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('FileConfigStore.writeFilesAtomic', () => {
  it('writes every file on success', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const a = join(root, 'a.json');
    const b = join(root, 'sub', 'b.json');
    const res = await store.writeFilesAtomic([
      { path: a, content: '{"a":1}\n' },
      { path: b, content: '{"b":2}\n' },
    ]);
    expect(res.ok).toBe(true);
    expect(readFileSync(a, 'utf8')).toBe('{"a":1}\n');
    expect(readFileSync(b, 'utf8')).toBe('{"b":2}\n');
  });

  it('rolls back committed files and reports the failing path when one target is unwritable', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const a = join(root, 'a.json');
    const locked = join(root, 'locked.json');
    const c = join(root, 'c.json');
    // a and c exist before with known bytes; a will be committed then rolled back.
    writeFileSync(a, 'OLD-A\n');
    // `locked.json` is a NON-EMPTY directory → renaming a file onto it fails.
    mkdirSync(locked);
    writeFileSync(join(locked, 'child'), 'x');

    const res = await store.writeFilesAtomic([
      { path: a, content: 'NEW-A\n' },
      { path: locked, content: 'NEW-LOCKED\n' },
      { path: c, content: 'NEW-C\n' },
    ]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failedPath).toBe(locked);
    // a rolled back to its prior bytes; c (absent before, never committed) not created.
    expect(readFileSync(a, 'utf8')).toBe('OLD-A\n');
    expect(() => readFileSync(c, 'utf8')).toThrow();
    // No staging temp files left behind.
    expect(() => readFileSync(`${a}.staging`, 'utf8')).toThrow();
  });

  it('leaves everything untouched and deletes a file that did not exist before on rollback', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const newFile = join(root, 'fresh.json'); // absent before
    const locked = join(root, 'locked.json');
    mkdirSync(locked);
    writeFileSync(join(locked, 'child'), 'x');

    const res = await store.writeFilesAtomic([
      { path: newFile, content: 'FRESH\n' },
      { path: locked, content: 'NOPE\n' },
    ]);
    expect(res.ok).toBe(false);
    // fresh.json was committed then removed (absent-before) on rollback.
    expect(() => readFileSync(newFile, 'utf8')).toThrow();
  });
});
