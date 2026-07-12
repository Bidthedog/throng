import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * US6 (007 Phase G): reset-current restores the tab's defaults (disabled for a
 * user theme), reset-all reverts the session to the on-entry snapshot, and both
 * require an explicit confirmation (cancel is a no-op).
 */
const cfgRoots: string[] = [];
function freshCfgRoot(seedThemes: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-reset-'));
  cfgRoots.push(dir);
  if (Object.keys(seedThemes).length) {
    const themesDir = join(dir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    for (const [name, theme] of Object.entries(seedThemes)) {
      writeFileSync(join(themesDir, `${name}.json`), JSON.stringify(theme, null, 2), 'utf8');
    }
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
async function openPrefs(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings' | 'themes',
): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

test('the per-tab reset restores the Settings editor from the shipped record (with confirm)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      // Change a setting away from default.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      // Reset-current → confirm.
      await prefs.getByTestId('prefs-reset-current').click();
      await expect(prefs.getByTestId('prefs-reset-confirm')).toBeVisible();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false); // default
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('the per-tab reset is HIDDEN on the Themes tab (015, FR-011)', async () => {
  // It used to be shown-but-disabled for a custom theme. Feature 014 gives every built-in
  // theme row its own restore-to-shipped affordance, so a per-tab reset here would be a
  // second control performing an identical write — it is removed rather than disabled.
  const cfgRoot = freshCfgRoot({
    MyUser: { name: 'MyUser', colours: {}, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();
      await expect(prefs.getByTestId('prefs-reset-current')).toHaveCount(0);
      // …while on an editor tab it is present and names the editor it applies to.
      await prefs.getByTestId('prefs-tab-settings').click();
      await expect(prefs.getByTestId('prefs-reset-current')).toBeVisible();
      await expect(prefs.getByTestId('prefs-reset-current')).toHaveAttribute(
        'title',
        'Reset the Settings editor to its defaults',
      );
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('every toolbar control is a THEMED icon with a truthful title (015, FR-009b/FR-012a)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      const resetCurrent = prefs.getByTestId('prefs-reset-current');
      const resetPreferences = prefs.getByTestId('prefs-reset-preferences');
      const revertAll = prefs.getByTestId('prefs-revert-all');
      const modeToggle = prefs.getByTestId('prefs-mode-toggle');
      // Names state the true scope. "Revert All" was a session undo calling itself a reset-all,
      // and the id `prefs-reset-all` named a scope it did not have.
      await expect(resetCurrent).toHaveAttribute('title', 'Reset the Settings editor to its defaults');
      await expect(resetPreferences).toHaveAttribute('title', 'Reset All Preferences');
      await expect(revertAll).toHaveAttribute('title', 'Revert All Preferences');
      // The misleading identifier is gone: `prefs-reset-all` used to belong to the SESSION UNDO.
      await expect(prefs.getByTestId('prefs-reset-all')).toHaveCount(0);
      // Icons now come from theme tokens — NO inline <svg> survives anywhere in the toolbar
      // (constitution v3.12.0; these were recorded as known violations at that amendment).
      await expect(resetCurrent.locator('svg')).toHaveCount(0);
      await expect(resetPreferences.locator('svg')).toHaveCount(0);
      await expect(revertAll.locator('svg')).toHaveCount(0);
      await expect(modeToggle.locator('svg')).toHaveCount(0);
      // Each renders a themed glyph.
      expect((await resetCurrent.innerText()).trim().length).toBeGreaterThan(0);
      expect((await resetPreferences.innerText()).trim().length).toBeGreaterThan(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('reset-all reverts the session to on-entry; cancel is a no-op', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      // Edit a setting.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      // Reset-all → cancel: no change.
      await prefs.getByTestId('prefs-revert-all').click();
      await prefs.getByTestId('prefs-reset-confirm-no').click();
      expect(readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      // Reset-all → confirm: reverts to on-entry (autoSave false).
      await prefs.getByTestId('prefs-revert-all').click();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

/* ------------------------------------------------------------------------- *
 * Feature 015 — granular reset controls.
 *
 * Feature 010 shipped the reset API and no UI; these journeys are the UI. The
 * per-item affordance is shown ONLY while the item is overridden, so it doubles as
 * the row's "modified" cue (FR-004a).
 * ------------------------------------------------------------------------- */

function readKeybindings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'keybindings.json'), 'utf8'));
  } catch {
    return null;
  }
}

test('US1: a key binding shows a reset icon only once overridden, and resetting it restores the shipped chords', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');
      await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();

      // Pristine: the row is at its shipped binding, so it carries NO reset affordance.
      await expect(prefs.getByTestId('binding-reset-zoom.in')).toBeDisabled();

      // `zoom.in` ships with MULTIPLE chords — remember them, because a reset must restore
      // the FULL set, not just the one we remove (US1/AC4).
      const shippedZoomIn: string[] = readKeybindings(cfgRoot).bindings['zoom.in'];
      expect(shippedZoomIn.length).toBeGreaterThan(1);

      // Customise two actions by dropping one chord from each.
      await prefs.getByTestId('binding-zoom.in-remove-0').click();
      // The row immediately advertises itself as modified — the affordance IS the cue (FR-004a).
      await expect(prefs.getByTestId('binding-reset-zoom.in')).toBeEnabled();
      await expect
        .poll(() => readKeybindings(cfgRoot)?.bindings?.['zoom.in']?.length)
        .toBe(shippedZoomIn.length - 1);

      await prefs.getByTestId('binding-zoom.out-remove-0').click();
      await expect(prefs.getByTestId('binding-reset-zoom.out')).toBeEnabled();
      const zoomOutAfterEdit: string[] = readKeybindings(cfgRoot).bindings['zoom.out'];

      // Reset exactly one — no confirmation, applied immediately.
      await prefs.getByTestId('binding-reset-zoom.in').click();
      // The FULL shipped chord set comes back, not just the removed chord.
      await expect
        .poll(() => readKeybindings(cfgRoot)?.bindings?.['zoom.in'])
        .toEqual(shippedZoomIn);

      // Its affordance disappears (it is no longer modified) …
      await expect(prefs.getByTestId('binding-reset-zoom.in')).toBeDisabled();
      // … while the OTHER customisation is untouched and still offers its reset.
      expect(readKeybindings(cfgRoot)?.bindings?.['zoom.out']).toEqual(zoomOutAfterEdit);
      await expect(prefs.getByTestId('binding-reset-zoom.out')).toBeEnabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('US2: a setting shows a reset icon only once overridden, and resetting it leaves its siblings alone', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // Pristine: no reset affordance anywhere.
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeDisabled();

      // Change two leaves under the same section.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeEnabled();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);

      const debounce = prefs.getByTestId('control-editor.autoSaveDebounceMs');
      await debounce.fill('900');
      await debounce.blur();
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSaveDebounceMs).toBe(900);
      // Both rows are now modified, and both say so.
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeEnabled();

      // Reset one leaf — immediate, no confirmation.
      await prefs.getByTestId('setting-reset-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false);
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeDisabled();

      // The sibling leaf keeps the user's value and keeps its affordance.
      expect(readSettings(cfgRoot)?.editor?.autoSaveDebounceMs).toBe(900);
      await expect(prefs.getByTestId('setting-reset-editor.autoSaveDebounceMs')).toBeEnabled();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('US3: Reset All Preferences restores settings + bindings, states both sides of its scope, and spares custom themes', async () => {
  const cfgRoot = freshCfgRoot({
    MyUser: { name: 'MyUser', colours: { accent: '#abcdef' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // Customise a setting and a binding.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);
      await prefs.getByTestId('prefs-tab-keybindings').click();
      const shippedZoomIn: string[] = readKeybindings(cfgRoot).bindings['zoom.in'];
      await prefs.getByTestId('binding-zoom.in-remove-0').click();
      await expect(prefs.getByTestId('binding-reset-zoom.in')).toBeEnabled();
      await expect
        .poll(() => readKeybindings(cfgRoot)?.bindings?.['zoom.in']?.length)
        .toBe(shippedZoomIn.length - 1);

      // The confirmation must state BOTH what is reset AND what survives (FR-006).
      await prefs.getByTestId('prefs-reset-preferences').click();
      const confirm = prefs.getByTestId('prefs-reset-confirm');
      await expect(confirm).toBeVisible();
      const copy = (await confirm.innerText()).toLowerCase();
      expect(copy).toContain('settings');
      expect(copy).toContain('key bindings');
      expect(copy).toContain('projects');

      await prefs.getByTestId('prefs-reset-confirm-yes').click();

      // Settings and bindings are back to shipped …
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false);
      await expect.poll(() => readKeybindings(cfgRoot)?.bindings?.['zoom.in']).toEqual(shippedZoomIn);
      // … and the user's CUSTOM theme is still on disk, untouched.
      const custom = JSON.parse(readFileSync(join(cfgRoot, 'themes', 'MyUser.json'), 'utf8'));
      expect(custom.colours.accent).toBe('#abcdef');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('JSON mode hides the row affordances but keeps the toolbar controls', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // Override a setting so the row affordance exists in UI mode.
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeEnabled();

      // Switch to JSON: the row affordances are GONE, not merely disabled. Disabled means "this
      // action does not apply to this row yet"; in JSON mode there is no row at all, so the
      // affordance has nothing to be an affordance OF (FR-013a).
      await prefs.getByTestId('prefs-mode-toggle').click();
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toHaveCount(0);
      // … but every toolbar control remains reachable.
      await expect(prefs.getByTestId('prefs-reset-preferences')).toBeVisible();
      await expect(prefs.getByTestId('prefs-revert-all')).toBeVisible();
      await expect(prefs.getByTestId('prefs-reset-current')).toBeVisible();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a reset that cannot be written says so, and says nothing changed (FR-006a, SC-012)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeEnabled();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);

      // Make settings.json unwritable the only way Windows reliably allows: replace it with a
      // NON-EMPTY directory, so the atomic commit's rename fails and feature 010 rolls back.
      const settingsPath = join(cfgRoot, 'settings.json');
      const saved = readFileSync(settingsPath, 'utf8');
      rmSync(settingsPath, { force: true });
      mkdirSync(settingsPath, { recursive: true });
      writeFileSync(join(settingsPath, 'blocker.txt'), 'x', 'utf8');

      await prefs.getByTestId('setting-reset-editor.autoSave').click();

      // It must NOT fail silently: the message names the operation and states nothing changed.
      const notice = prefs.getByTestId('prefs-notice');
      await expect(notice).toBeVisible();
      expect((await notice.innerText()).toLowerCase()).toContain('nothing was changed');
      // And it is dismissable.
      await prefs.getByTestId('prefs-notice-dismiss').click();
      await expect(notice).toHaveCount(0);

      // Put the file back so teardown is clean.
      rmSync(settingsPath, { recursive: true, force: true });
      writeFileSync(settingsPath, saved, 'utf8');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('a reset performed in JSON mode refreshes the visible document (FR-013b)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(true);

      // Switch to JSON — the buffer is CLEAN (we have typed nothing into it).
      await prefs.getByTestId('prefs-mode-toggle').click();
      const json = prefs.getByTestId('json-editor-settings');
      await expect(json).toBeVisible();
      await expect(json).toContainText('"autoSave": true');

      // Reset the whole editor from the toolbar while JSON mode is showing.
      await prefs.getByTestId('prefs-reset-current').click();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();

      // The document the user is looking at follows the file — no stale text (FR-013b).
      await expect.poll(() => readSettings(cfgRoot)?.editor?.autoSave).toBe(false);
      await expect(json).toContainText('"autoSave": false');
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('resets are idempotent, and the four scopes are distinguishable (SC-003, SC-008, SC-011)', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // Reset All Preferences on a pristine config: a successful no-op that changes nothing.
      const before = JSON.stringify(readSettings(cfgRoot));
      await prefs.getByTestId('prefs-reset-preferences').click();
      await prefs.getByTestId('prefs-reset-confirm-yes').click();
      await expect(prefs.getByTestId('prefs-notice')).toHaveCount(0); // no failure
      await expect.poll(() => JSON.stringify(readSettings(cfgRoot))).toBe(before);
      // Nothing is overridden, so no row advertises itself as modified.
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeDisabled();

      // The four scopes read differently from their titles alone — none claims another's reach.
      const titles = await Promise.all(
        ['prefs-reset-current', 'prefs-reset-preferences', 'prefs-revert-all'].map((id) =>
          prefs.getByTestId(id).getAttribute('title'),
        ),
      );
      expect(new Set(titles).size).toBe(titles.length);
      expect(titles).toEqual([
        'Reset the Settings editor to its defaults',
        'Reset All Preferences',
        'Revert All Preferences',
      ]);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
