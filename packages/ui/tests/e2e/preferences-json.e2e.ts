import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US5 (007 Phase C): the global UI⇄JSON toggle + standalone JSON editor. The
 * toggle flips all tabs together and stays visible at the minimum window size;
 * valid JSON applies + persists, invalid JSON is surfaced and not applied; the
 * Themes JSON follows the selected theme; a malformed file shows its raw text.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-json-'));
  cfgRoots.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});
function readSettings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}
async function openSettings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

/** Replace the CodeMirror editor's content (CM ignores input.fill). The apply is
 *  debounced on every keystroke, so no blur is needed. */
async function setEditorText(prefs: Page, kind: string, content: string): Promise<void> {
  const editor = prefs.getByTestId(`json-editor-${kind}`).locator('.cm-content');
  await editor.click();
  await prefs.keyboard.press('Control+A');
  await editor.pressSequentially(content);
}

test('the toggle flips all tabs to JSON and stays visible; valid JSON applies, invalid is surfaced', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // Toggle to JSON — the Settings tab now shows the JSON editor.
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      // The code editor is one of the few surfaces that MAY select text (the
      // app-wide user-select:none is lifted for .cm-editor).
      expect(
        await prefs
          .getByTestId('json-editor-settings')
          .locator('.cm-content')
          .evaluate((el) => getComputedStyle(el).userSelect),
      ).toBe('text');
      // Switch to Key Bindings — it too is JSON (global toggle, FR-020).
      await prefs.getByTestId('prefs-tab-keybindings').click();
      await expect(prefs.getByTestId('json-tab-keybindings')).toBeVisible();
      await prefs.getByTestId('prefs-tab-settings').click();

      // The toggle stays visible at the minimum window size (FR-019).
      await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
        wins[wins.length - 1].setSize(420, 360); // prefs window minimum
      });
      await expect(prefs.getByTestId('prefs-mode-toggle')).toBeVisible();

      // Edit valid JSON → applies + persists (the tolerant reader merges the rest
      // over defaults, so a minimal valid document is enough to set the theme).
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');

      // Invalid JSON → surfaced, not applied (theme stays Matrix).
      await setEditorText(prefs, 'settings', '{ not valid');
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();
      expect(readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/**
 * FR-041 (dirty side). An incomplete document never applies (it is invalid JSON),
 * so the buffer stays dirty — precisely the "user is mid-edit on the same document"
 * state the requirement describes. An external change arriving now must be
 * surfaced, never silently adopted and never silently discarded.
 */
const MID_EDIT = '{"appearance":{"theme":"Matrix"';

async function openSettingsJson(app: ElectronApplication, win: Page): Promise<Page> {
  const prefs = await openSettings(app, win);
  await prefs.getByTestId('prefs-mode-toggle').click();
  await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
  return prefs;
}

test('an external change to a dirty JSON buffer is surfaced, and reload adopts it (FR-041)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      await setEditorText(prefs, 'settings', MID_EDIT);
      await expect(prefs.getByTestId('json-invalid')).toBeVisible(); // dirty: never applied

      writeFileSync(join(cfgRoot, 'settings.json'), '{"appearance":{"theme":"Cyberpunk"}}\n', 'utf8');

      // Surfaced (not silently applied), and the user's edit is NOT clobbered.
      await expect(prefs.getByTestId('json-conflict')).toBeVisible();
      await expect(prefs.getByTestId('json-editor-settings')).toContainText('Matrix');

      // Reload adopts the external document and clears both banners.
      await prefs.getByTestId('json-conflict-reload').click();
      await expect(prefs.getByTestId('json-conflict')).toHaveCount(0);
      await expect(prefs.getByTestId('json-editor-settings')).toContainText('Cyberpunk');
      await expect(prefs.getByTestId('json-invalid')).toHaveCount(0);

      // Reloading adopts — it must not write back, and must not resurrect the
      // abandoned mid-edit via a still-pending debounced apply.
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Cyberpunk');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('keep-editing preserves a dirty JSON buffer and the next apply wins (FR-041)', async () => {
  const cfgRoot = freshCfgRoot({ 'settings.json': '{"appearance":{"theme":"throng"}}\n' });
  await runApp(
    async (app, win) => {
      const prefs = await openSettingsJson(app, win);

      await setEditorText(prefs, 'settings', MID_EDIT);
      await expect(prefs.getByTestId('json-invalid')).toBeVisible();

      writeFileSync(join(cfgRoot, 'settings.json'), '{"appearance":{"theme":"Cyberpunk"}}\n', 'utf8');
      await expect(prefs.getByTestId('json-conflict')).toBeVisible();

      // Keep editing: the conflict is dismissed and the buffer survives intact.
      await prefs.getByTestId('json-conflict-keep').click();
      await expect(prefs.getByTestId('json-conflict')).toHaveCount(0);
      await expect(prefs.getByTestId('json-editor-settings')).toContainText('Matrix');

      // Completing the edit applies — the user's document overwrites the external one.
      await setEditorText(prefs, 'settings', '{"appearance":{"theme":"Matrix"}}');
      await expect.poll(() => readSettings(cfgRoot)?.appearance?.theme).toBe('Matrix');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a malformed settings.json shows its raw text in the JSON editor for repair (FR-043)', async () => {
  const malformed = '{ "appearance": { "theme": "throng" }  <-- broken';
  const cfgRoot = freshCfgRoot({ 'settings.json': malformed });
  await runApp(
    async (app, win) => {
      const prefs = await openSettings(app, win);
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('json-tab-settings')).toBeVisible();
      await expect(prefs.getByTestId('json-editor-settings')).toContainText('<-- broken');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
