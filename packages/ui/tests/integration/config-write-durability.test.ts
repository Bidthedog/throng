import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigDoc } from '../../src/main/config-write-ipc.js';

/**
 * Config-write durability (issue #75, part 1).
 *
 * A single-document config write is `writeFile(tmp)` + `rename(tmp, path)`. On Windows that
 * rename intermittently fails with EPERM when something else holds a handle on the target
 * without share-delete — Defender, the search indexer, or our own config watcher mid-read.
 * It is transient: the handle is gone milliseconds later.
 *
 * Two defects met here. The write SWALLOWED that EPERM and resolved as though it had
 * succeeded, and the IPC layer above it then reported `{ok:true}` unconditionally — so a
 * preference edit could vanish with the UI showing the new value and nothing logged as a
 * failure. Under CI load this is what reddens the preferences E2E specs: they poll the file
 * for a value that was never written.
 *
 * The fault is injected the way `config-store-atomic.test.ts` already does it — a non-empty
 * directory sitting on the target path, which makes `rename` fail with a real EPERM (verified:
 * the same code the production race produces) rather than a mocked one.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-durability-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Put a non-empty directory on `path`, so renaming a file onto it fails with EPERM. */
function obstruct(path: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'child'), 'x');
}

describe('FileConfigStore.write durability', () => {
  it('reports failure when the target cannot be written', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    obstruct(store.pathOf({ kind: 'settings' }));

    const result = await store.write({ kind: 'settings' }, { editor: { autoSaveDebounceMs: 1500 } });

    expect(result.ok).toBe(false);
  });

  it('retries a transient rename failure and lands the value', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const path = store.pathOf({ kind: 'settings' });
    obstruct(path);
    // Clear the obstruction shortly after the write starts, exactly as a real AV/indexer
    // handle is released: the first rename attempt fails, a later one must succeed.
    const clearing = new Promise<void>((resolve) =>
      setTimeout(() => {
        rmSync(path, { recursive: true, force: true });
        resolve();
      }, 150),
    );

    const result = await store.write({ kind: 'settings' }, { editor: { autoSaveDebounceMs: 1500 } });
    await clearing;

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ editor: { autoSaveDebounceMs: 1500 } });
  });

  it('does not leave its temp file behind when the write ultimately fails', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    obstruct(store.pathOf({ kind: 'settings' }));

    await store.write({ kind: 'settings' }, { editor: { autoSaveDebounceMs: 1500 } });

    const strays = readdirSync(root).filter((name) => name.includes('.tmp'));
    expect(strays).toEqual([]);
  });
});

describe('writeConfigDoc', () => {
  it('reports the failure instead of claiming success when the store cannot write', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    obstruct(store.pathOf({ kind: 'settings' }));

    const result = await writeConfigDoc(store, { kind: 'settings' }, '{"editor":{"autoSaveDebounceMs":1500}}');

    // The defect: this returned {ok:true} for a write that never reached disk, so the
    // renderer published the edit as applied and the user's change was silently lost.
    expect(result.ok).toBe(false);
  });
});
