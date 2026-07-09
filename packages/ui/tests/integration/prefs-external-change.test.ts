import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, THRONG_THEME, type IConfigSettings } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { startConfigWatcher, type ConfigPayload } from '../../src/main/config-watcher.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

/**
 * FR-041 (external-change reflection, clean side): when a config file is edited
 * OUTSIDE throng while the preferences window is open, the running watcher
 * rebroadcasts the new content, so the live-config-backed UI forms (which read
 * useAppSettings/useActiveTheme/useKeybindings) reload to the external value —
 * external wins for a clean buffer. This asserts the underlying broadcast; the
 * dirty-buffer conflict prompt is a JSON-editor concern (US5).
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-extchg-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
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
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('preferences external-change reflection (FR-041 clean side)', () => {
  it('an external settings.json edit rebroadcasts the new value', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);

    const config: IConfigSettings = { configRoot: root, hotReloadDebounceMs: 20 };
    const broadcasts: ConfigPayload[] = [];
    const sub = startConfigWatcher({ store, watcher: new NodeFileWatcher(20), config, broadcast: (p) => broadcasts.push(p) });
    try {
      // Simulate an external editor writing the file directly (not via config.write).
      writeFileSync(
        join(root, 'settings.json'),
        JSON.stringify({ ...DEFAULT_APP_SETTINGS, appearance: { theme: 'gothic' } }, null, 2),
        'utf8',
      );
      await waitFor(() => broadcasts.some((p) => p.settings.appearance.theme === 'gothic'));
      expect(broadcasts.at(-1)?.settings.appearance.theme).toBe('gothic');
    } finally {
      sub.dispose();
    }
  });

  it('an external theme-file edit rebroadcasts the new active theme content', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS); // active theme = throng
    await store.write({ kind: 'theme', name: 'throng' }, THRONG_THEME);

    const config: IConfigSettings = { configRoot: root, hotReloadDebounceMs: 20 };
    const broadcasts: ConfigPayload[] = [];
    const sub = startConfigWatcher({ store, watcher: new NodeFileWatcher(20), config, broadcast: (p) => broadcasts.push(p) });
    try {
      writeFileSync(
        join(root, 'themes', 'throng.json'),
        JSON.stringify({ ...THRONG_THEME, colours: { ...THRONG_THEME.colours, accent: '#abcdef' } }, null, 2),
        'utf8',
      );
      await waitFor(() => broadcasts.some((p) => p.theme.colours.accent === '#abcdef'));
      expect(broadcasts.at(-1)?.theme.colours.accent).toBe('#abcdef');
    } finally {
      sub.dispose();
    }
  });
});
