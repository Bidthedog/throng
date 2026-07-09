import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  THRONG_THEME,
  revertAll,
  type OnEntrySnapshot,
  type Theme,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { writeConfigDoc } from '../../src/main/config-write-ipc.js';
import { readConfigPayload } from '../../src/main/config-watcher.js';

/**
 * Reset-all (007, FR-024): after editing settings + two theme files (across a
 * theme switch), applying the revertAll write-plan restores every touched file to
 * its on-entry contents and re-activates the on-entry theme.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-resetall-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const matrixOnEntry: Theme = {
  ...THRONG_THEME,
  name: 'Matrix',
  colours: { ...THRONG_THEME.colours, accent: '#00ff41' },
};

describe('reset-all reverts the session snapshot', () => {
  it('restores settings + keybindings + edited themes and re-activates the on-entry theme', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    // On-entry state (active theme = throng).
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);
    await store.write({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS);
    await store.write({ kind: 'theme', name: 'throng' }, THRONG_THEME);
    await store.write({ kind: 'theme', name: 'Matrix' }, matrixOnEntry);

    const snapshot: OnEntrySnapshot = {
      settings: JSON.stringify(DEFAULT_APP_SETTINGS),
      keybindings: JSON.stringify(DEFAULT_KEYBINDINGS),
      themes: { throng: JSON.stringify(THRONG_THEME), Matrix: JSON.stringify(matrixOnEntry) },
      activeTheme: 'throng',
    };

    // Edits this session: switch active theme + edit BOTH theme files.
    await writeConfigDoc(store, { kind: 'settings' }, JSON.stringify({ ...DEFAULT_APP_SETTINGS, appearance: { theme: 'Matrix' } }));
    await writeConfigDoc(store, { kind: 'theme', name: 'throng' }, JSON.stringify({ ...THRONG_THEME, colours: { ...THRONG_THEME.colours, accent: '#ffffff' } }));
    await writeConfigDoc(store, { kind: 'theme', name: 'Matrix' }, JSON.stringify({ ...matrixOnEntry, colours: { ...matrixOnEntry.colours, accent: '#123456' } }));

    // Reset-all.
    for (const entry of revertAll(snapshot)) {
      const res = await writeConfigDoc(store, entry.id, entry.json);
      expect(res.ok).toBe(true);
    }

    const payload = await readConfigPayload(store);
    expect(payload.settings.appearance.theme).toBe('throng'); // re-activated on-entry theme

    const throng = await store.read({ kind: 'theme', name: 'throng' }, THRONG_THEME, (r) => r as Theme);
    expect(throng.colours.accent).toBe(THRONG_THEME.colours.accent); // reverted
    const matrix = await store.read({ kind: 'theme', name: 'Matrix' }, THRONG_THEME, (r) => r as Theme);
    expect(matrix.colours.accent).toBe('#00ff41'); // reverted to on-entry Matrix
  });
});
