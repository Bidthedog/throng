/**
 * Integration tests for the UI-main {@link FileConfigStore} (T033 / contract
 * os-config-store.md). Runs the shared IConfigStore contract suite against the
 * real filesystem (temp dir) plus first-run / path-layout assertions.
 */
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { runConfigStoreContract } from '@throng/core/testing';
import { DEFAULT_NOTIFICATION_SETTINGS, type ConfigDocId } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigOnce } from '../../src/main/config-watcher.js';
import { writeConfigPatch } from '../../src/main/config-write-ipc.js';

const made: string[] = [];
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  made.push(d);
  return d;
}
afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true });
});

runConfigStoreContract('FileConfigStore', async () => {
  const store = new FileConfigStore(tempRoot());
  return {
    store,
    async seedRaw(doc: ConfigDocId, raw: string) {
      const p = store.pathOf(doc);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, raw, 'utf8');
    },
  };
});

describe('FileConfigStore first-run + layout', () => {
  it('creates the defaults file on disk when it is absent', async () => {
    const store = new FileConfigStore(tempRoot());
    const doc: ConfigDocId = { kind: 'settings' };
    expect(existsSync(store.pathOf(doc))).toBe(false);

    const defaults = { version: 1 };
    const read = await store.read(doc, defaults, (r) => (r as typeof defaults) ?? defaults);
    expect(read).toEqual(defaults);
    expect(existsSync(store.pathOf(doc))).toBe(true);
    expect(JSON.parse(readFileSync(store.pathOf(doc), 'utf8'))).toEqual(defaults);
  });

  it('leaves a malformed file intact for the user (no overwrite)', async () => {
    const root = tempRoot();
    const store = new FileConfigStore(root);
    const doc: ConfigDocId = { kind: 'settings' };
    mkdirSync(root, { recursive: true });
    writeFileSync(store.pathOf(doc), '{ broken', 'utf8');

    await store.read(doc, { version: 1 }, (r) => r as { version: number });
    expect(readFileSync(store.pathOf(doc), 'utf8')).toBe('{ broken'); // untouched
  });

  it('places settings/keybindings at the root and themes under themes/', () => {
    const root = tempRoot();
    const store = new FileConfigStore(root);
    expect(store.pathOf({ kind: 'settings' })).toBe(join(root, 'settings.json'));
    expect(store.pathOf({ kind: 'keybindings' })).toBe(join(root, 'keybindings.json'));
    expect(store.pathOf({ kind: 'theme', name: 'throng' })).toBe(join(root, 'themes', 'throng.json'));
  });
});

/*
 * MIGRATED FROM `packages/ui/tests/e2e/settings-write-integrity.e2e.ts:190` ("a changed setting is what loads after
 * a restart", 032 FR-006) and `packages/ui/tests/e2e/notification-prefs.e2e.ts:443` ("a pre-030 settings file opens
 * with its preferences intact and no configuration error", 030 FR-014/SC-014).
 *
 * Layer: integration — the claim is what STARTUP reads from a real config root. A "restart" is a second store over
 * the same directory: nothing carries over but the file, which is all the second launch ever had. No window is
 * needed to observe it; the Preferences-window half of the old restart test is `component/preferences-app.test.ts`.
 */
describe('what startup reads from a config root', () => {
  it('a setting written through the write path is what a fresh store reads (FR-006)', async () => {
    const root = tempRoot();
    const first = new FileConfigStore(root);
    await readConfigOnce(first); // first run seeds the shipped documents, as a first launch does
    expect((await readConfigOnce(first)).payload.settings.notifications.error.mode).toBe('dismiss');

    await writeConfigPatch(first, { kind: 'settings' }, [
      { path: ['notifications', 'error', 'mode'], value: 'timed' },
    ]);

    // A restart: a second store over the same root.
    const { payload, settingsUnreadable } = await readConfigOnce(new FileConfigStore(root));
    expect(settingsUnreadable).toBe(false);
    expect(payload.settings.notifications.error.mode).toBe('timed');
  });

  it('a settings file with no notifications section resolves to the shipped defaults and keeps the user’s own values (FR-014, SC-014)', async () => {
    const root = tempRoot();
    // What a user upgrading into 030 has: no notification preferences at all, and settings changed from the defaults.
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({ version: 1, editor: { autoSave: true, autoSaveDebounceMs: 900 } }),
      'utf8',
    );

    const { payload, settingsUnreadable } = await readConfigOnce(new FileConfigStore(root));

    // Not "could not be read" — the half a parse test cannot see: nothing downstream has reason to complain.
    expect(settingsUnreadable).toBe(false);
    expect(payload.settings.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    // An upgrade that "worked" by resetting the file would pass a test that only looked at the notifications.
    expect(payload.settings.editor.autoSave).toBe(true);
    expect(payload.settings.editor.autoSaveDebounceMs).toBe(900);
  });
});
