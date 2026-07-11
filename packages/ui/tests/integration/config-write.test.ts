import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, THRONG_THEME, type IConfigSettings } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigDoc } from '../../src/main/config-write-ipc.js';
import { readConfigPayload, startConfigWatcher, type ConfigPayload } from '../../src/main/config-watcher.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

const tempDirs: string[] = [];

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfgwrite-'));
  tempDirs.push(dir);
  return dir;
}

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // Best-effort: on the Windows CI runner a recursive fs.watch handle can linger
      // past the retry window and block rmdir (ENOTEMPTY/EBUSY). The dir is under the
      // runner temp (auto-cleaned) and removes cleanly locally — don't fail a passing
      // test on a teardown race.
    }
  }
});

describe('config.write — writeConfigDoc', () => {
  it('writes settings atomically; the re-read payload reflects the change (FR-016/018)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);

    const next = { ...DEFAULT_APP_SETTINGS, appearance: { theme: 'matrix' } };
    const res = await writeConfigDoc(store, { kind: 'settings' }, JSON.stringify(next));
    expect(res).toEqual({ ok: true });

    const payload = await readConfigPayload(store);
    expect(payload.settings.appearance.theme).toBe('matrix');

    const raw = readFileSync(join(root, 'settings.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true); // atomic pretty writer
  });

  it('the running config watcher rebroadcasts after a write (immediate-apply path)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);

    const config: IConfigSettings = { configRoot: root, hotReloadDebounceMs: 20 };
    const broadcasts: ConfigPayload[] = [];
    const sub = startConfigWatcher({
      store,
      watcher: new NodeFileWatcher(20),
      config,
      broadcast: (p) => broadcasts.push(p),
    });
    try {
      const next = { ...DEFAULT_APP_SETTINGS, appearance: { theme: 'cyberpunk' } };
      await writeConfigDoc(store, { kind: 'settings' }, JSON.stringify(next));
      await waitFor(() => broadcasts.some((p) => p.settings.appearance.theme === 'cyberpunk'));
      expect(broadcasts.at(-1)?.settings.appearance.theme).toBe('cyberpunk');
    } finally {
      sub.dispose();
    }
  });

  it('rejects invalid JSON and leaves the file unchanged (FR-017)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);
    const before = readFileSync(join(root, 'settings.json'), 'utf8');

    const res = await writeConfigDoc(store, { kind: 'settings' }, '{ not: valid json');
    expect(res.ok).toBe(false);
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(before);
  });

  it('rejects a non-object JSON document (array/primitive) without writing (FR-017)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    expect((await writeConfigDoc(store, { kind: 'settings' }, '[1,2,3]')).ok).toBe(false);
    expect((await writeConfigDoc(store, { kind: 'settings' }, '42')).ok).toBe(false);
    expect(existsSync(join(root, 'settings.json'))).toBe(false);
  });

  it('refuses a theme name that escapes the config roots, writing nothing outside (FR-042)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const doc = JSON.stringify({ ...THRONG_THEME, name: 'evil' });
    for (const name of ['../../evil', '..\\..\\evil', 'C:/evil', '/etc/evil', 'a/b', '..', '.']) {
      const res = await writeConfigDoc(store, { kind: 'theme', name }, doc);
      expect(res.ok, `name=${name}`).toBe(false);
    }
    expect(existsSync(join(dirname(root), 'evil.json'))).toBe(false);
  });

  it('writes a legitimate theme file under themes/', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const res = await writeConfigDoc(
      store,
      { kind: 'theme', name: 'mytheme' },
      JSON.stringify({ ...THRONG_THEME, name: 'mytheme' }),
    );
    expect(res).toEqual({ ok: true });
    expect(existsSync(join(root, 'themes', 'mytheme.json'))).toBe(true);
  });
});
