/**
 * 032 T008 — two writers, one document, nothing lost (FR-001/FR-002/FR-003, G2/G3).
 *
 * This is the layer the guarantee actually lives at. The E2E reproduction proves the defect is
 * reachable through the product; this proves the property holds deterministically, without needing
 * to win a ~45 ms race with a Playwright click.
 *
 * The tests below are written so that a REGRESSION IS UNAMBIGUOUS. Each one asserts on the final
 * document rather than on the return values, because every one of these writes reports success even
 * when the change it carried has been silently reverted — that is precisely what made #249 and #260
 * so hard to see.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigPatch } from '../../src/main/config-write-ipc.js';

const tempDirs: string[] = [];

function freshStore(seed: unknown): { store: FileConfigStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-write-concurrency-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'settings.json'), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  return { store: new FileConfigStore(root), root };
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('two windows, different keys (G2 — the #249 shape)', () => {
  it('both changes survive', async () => {
    // The literal reproduction: the Preferences window changes a notification mode while the main
    // window persists the folder it just used for a project.
    // Real values from `DISPLAY_MODES`, not plausible-looking ones. An unrecognised mode would be
    // substituted by the bounds guard and the test would be asserting the guard's behaviour rather
    // than the write's.
    const { store, root } = freshStore({
      notifications: { error: { mode: 'dismiss' } },
      newProject: { lastProjectFolder: 'D:/old' },
    });

    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['notifications', 'error', 'mode'], value: 'never' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/new' },
      ]),
    ]);

    const after = readSettings(root) as {
      notifications: { error: { mode: string } };
      newProject: { lastProjectFolder: string };
    };
    expect(after.notifications.error.mode).toBe('never');
    expect(after.newProject.lastProjectFolder).toBe('D:/new');
  });

  it('survives the reverse arrival order too', async () => {
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/second' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Matrix' },
      ]),
    ]);
    const after = readSettings(root) as {
      appearance: { theme: string };
      newProject: { lastProjectFolder: string };
    };
    expect(after.appearance.theme).toBe('Matrix');
    expect(after.newProject.lastProjectFolder).toBe('D:/second');
  });

  // Many writers at once: config-write-soak.test.ts (500 + 500 writers, SC-004).
});

describe('two windows, the same key (G3, disk half)', () => {
  it('resolves to the later CALLER, not the luckier scheduler', async () => {
    const { store, root } = freshStore(DEFAULT_APP_SETTINGS);
    await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'First' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Second' },
      ]),
    ]);
    expect((readSettings(root) as { appearance: { theme: string } }).appearance.theme).toBe('Second');
  });
});

// The mixed-channel case (a patch racing a whole-document write, no blend) is asserted in
// config-write-serialisation.test.ts, with the extra saveAllScope tell.

describe('the guarantee under a corrupt file', () => {
  it('a refused patch does not disturb a concurrent one', async () => {
    // Both patches read the same corrupt base, so both must refuse — and neither may write the
    // document it could not read.
    const { store, root } = freshStore({});
    writeFileSync(join(root, 'settings.json'), '{ broken', 'utf8');

    const results = await Promise.all([
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: 'Matrix' },
      ]),
      writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['newProject', 'lastProjectFolder'], value: 'D:/work' },
      ]),
    ]);

    expect(results).toEqual([
      { ok: false, error: 'read-failed' },
      { ok: false, error: 'read-failed' },
    ]);
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{ broken');
  });
});
