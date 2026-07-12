import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * Issue #50 — two edits in quick succession must not clobber each other.
 *
 * The preferences editors apply immediately and each edit writes the WHOLE document,
 * computed from the renderer's copy of it. That copy used to refresh only when the config
 * watcher round-tripped the file back, so a second edit made inside that window was computed
 * from a pre-first-edit snapshot and silently reverted the first. Nothing errored; the user's
 * change was simply gone.
 *
 * These tests do the edits back-to-back with no settling wait — the point is precisely that
 * the user is faster than the round-trip.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-rapid-'));
  cfgRoots.push(dir);
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

function readJson(cfgRoot: string, file: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, file), 'utf8'));
  } catch {
    return null;
  }
}

async function openPrefs(app: ElectronApplication, win: Page, tab: 'settings' | 'keybindings'): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

test('two key-binding edits in quick succession both survive (#50)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');
      await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();

      const zoomInBefore: string[] = readJson(cfgRoot, 'keybindings.json').bindings['zoom.in'];
      const zoomOutBefore: string[] = readJson(cfgRoot, 'keybindings.json').bindings['zoom.out'];

      // Back-to-back, with NO wait between them — this is the whole point.
      await prefs.getByTestId('binding-zoom.in-remove-0').click();
      await prefs.getByTestId('binding-zoom.out-remove-0').click();

      // Both removals must be on disk. Before the fix, the second write was computed from a
      // snapshot taken before the first landed, so zoom.in came back with all its chords.
      await expect
        .poll(() => readJson(cfgRoot, 'keybindings.json')?.bindings?.['zoom.out']?.length)
        .toBe(zoomOutBefore.length - 1);
      expect(readJson(cfgRoot, 'keybindings.json').bindings['zoom.in'].length).toBe(zoomInBefore.length - 1);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('two settings edits in quick succession both survive (#50)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      const before = readJson(cfgRoot, 'settings.json');
      expect(before.editor.autoSave).toBe(false);
      expect(before.editor.warnOnMissingFile).toBe(true);

      // Toggle two independent settings back-to-back, with NO wait between them.
      await prefs.getByTestId('control-editor.autoSave').click();
      await prefs.getByTestId('control-editor.warnOnMissingFile').click();

      await expect.poll(() => readJson(cfgRoot, 'settings.json')?.editor?.warnOnMissingFile).toBe(false);
      // The second toggle must not have reverted the first.
      expect(readJson(cfgRoot, 'settings.json').editor.autoSave).toBe(true);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
