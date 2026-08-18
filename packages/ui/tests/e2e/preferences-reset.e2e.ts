import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, runApp as runOwnApp, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';
import { writeConfigAtomic } from './helpers/config-write.js';

/**
 * US6 (007 Phase G): reset-current restores the tab's defaults (disabled for a
 * user theme), reset-all reverts the session to the on-entry snapshot, and both
 * require an explicit confirmation (cancel is a no-op).
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-reset-'));
  cfgRoots.push(dir);
  return dir;
}

/** Put a custom theme into the RUNNING app's themes directory (see `helpers/config-snapshot.ts`). */
function seedTheme(name: string, theme: unknown): void {
  mkdirSync(join(cfgRoot, 'themes'), { recursive: true });
  writeConfigAtomic(join(cfgRoot, 'themes', `${name}.json`), `${JSON.stringify(theme, null, 2)}\n`);
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Eight of the nine tests press reset/revert controls and then read settings.json or
 * keybindings.json — writes to the CONTENTS of a config root, which `restoreConfigRoot` undoes. One
 * seeded a custom theme, and a theme file is read per call, so it writes it into the running root.
 *
 * The ninth keeps its own app, and says why where it stands.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional. These tests share a window, a config root and the ONE preferences
 * window throng allows, so they must not interleave — and when one fails the rest are SKIPPED rather
 * than run against whatever state the failure left behind (see `openApp` in harness.ts).
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfgRoot: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfgRoot = freshCfgRoot();
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfgRoot } });
  await settle(shared.win);
  // Photograph the root only once first-run seeding has finished — settings, key bindings and every
  // shipped theme. A partial snapshot would have every later restore DELETE whatever arrived late.
  await expect.poll(() => configRootSeeded(cfgRoot), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfgRoot);
});

/*
 * Put the config root back between tests — with the preferences window CLOSED FIRST.
 *
 * The order is load-bearing twice over. A dirty JSON buffer raises `json-external-change` when the
 * file changes underneath it, so restoring against an open window would hand the next test a notice
 * it never asked for. And the on-entry snapshot that Revert and Revert All compare against is
 * captured when the preferences window MOUNTS (`preferences-app.tsx`), so carrying one window across
 * tests would carry the first test's baseline into the last one.
 */
test.afterEach(async () => {
  await closePrefsWindow(shared.app);
  await settleConfigRoot(baseline);
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of cfgRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

function readSettings(cfgRoot: string): any {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
}
/**
 * Open (or re-open) the Preferences window on a tab.
 *
 * Deliberately does NOT wait for a `window` event. throng has ONE shared Preferences window, so if a
 * previous test left it open the cog re-uses it and no new window is ever created — `waitForEvent`
 * then waits the full test timeout and the test fails at exactly 30s with no useful message. That is
 * an ordering dependency, not a defect: measured twice in one run, in a file that passes 5/5 alone.
 *
 * Instead: bring the main window forward (a stray window elsewhere on the desktop can otherwise eat
 * the cog click), then look for the Preferences page among the app's windows however it arrived.
 */
async function openPrefs(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings' | 'themes',
): Promise<Page> {
  await win.bringToFront();
  await win.getByTestId('title-bar-cog').click();
  await win.getByTestId(`cog-menu-${tab}`).click();

  let prefs: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (page === win || page.isClosed()) continue;
          if ((await page.getByTestId('prefs-mode-toggle').count()) > 0) {
            prefs = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  await prefs!.waitForLoadState('domcontentloaded');
  return prefs!;
}

test('the per-tab reset restores the Settings editor from the shipped record (with confirm)', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

/*
 * MOVED to `packages/ui/tests/component/preferences-toolbar.test.ts` (034 FR-045) — two tests:
 *   - the per-tab reset is HIDDEN on the Themes tab, present and named on the editor tabs (FR-011)
 *   - every toolbar control is a themed icon with a truthful title, no inline <svg>, and the
 *     misleading `prefs-reset-all` identifier is still gone (FR-009b/FR-012a)
 *
 * Each launched Electron, seeded a config root on disk and opened the preferences window in order
 * to read four `title` attributes and count `<svg>` elements. Nothing they asserted depended on a
 * process, a window, a file or a write.
 *
 * The blocker was structural rather than a judgement about layers: the markup lived inside
 * `PreferencesShell`, which reaches the config store, the confirm dialog, the reset notice, the
 * JSON edit gate and IPC, and so cannot mount outside Electron. `preferences-toolbar.tsx` was
 * extracted first and verified against these specs UNCHANGED — 11 here and 17 in
 * `preferences-json.e2e.ts`, both green — before a single test was touched.
 *
 * Red-proved, five mutations: the per-tab reset returning on Themes, a control regaining the
 * `prefs-reset-all` id, a title that stops naming its editor, reset-all and revert-all wired to
 * each other's handler, and the glyph losing its `aria-hidden`.
 *
 * WHAT STAYS: every test below that PRESSES one of these buttons and then reads the config off
 * disk. A component test sees a callback fire; that a click reaches a confirm dialog, an IPC call,
 * an atomic write and a reload is what those are for, and none of it is visible from jsdom.
 */

test('reset-all reverts the session to on-entry; cancel is a no-op', { tag: ['@extended', '@prefs'] }, async () => {
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

test('US1: a key binding shows a reset icon only once overridden, and resetting it restores the shipped chords', { tag: ['@extended', '@prefs'] }, async () => {
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

      const shippedZoomOut: string[] = readKeybindings(cfgRoot).bindings['zoom.out'];
      await prefs.getByTestId('binding-zoom.out-remove-0').click();
      await expect(prefs.getByTestId('binding-reset-zoom.out')).toBeEnabled();
      /*
       * Wait for the zoom.out edit to be WRITTEN before resetting zoom.in.
       *
       * The affordance turning enabled is renderer state; the file is written on a debounce. Reading
       * it straight away — and, worse, resetting zoom.in while that write is still pending — lets the
       * pending write land AFTER the reset, carrying a bindings map in which zoom.in is still the
       * edited version. The reset then looks broken: `zoom.in` comes back as
       * ["Ctrl++", "Ctrl+WheelUp"] with the shipped "Ctrl+=" missing.
       *
       * Measured unloaded, so this is not an artefact of a loaded machine: 2 failures in 11 runs, and
       * still 1 in 14 with the test budget raised to 120s — which is what ruled out slowness and
       * pointed at the write ordering.
       */
      await expect
        .poll(() => readKeybindings(cfgRoot)?.bindings?.['zoom.out']?.length)
        .toBe(shippedZoomOut.length - 1);
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
  );
});

test('US2: a setting shows a reset icon only once overridden, and resetting it leaves its siblings alone', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('US3: Reset All Preferences restores settings + bindings, states both sides of its scope, and spares custom themes', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      seedTheme('MyUser', { name: 'MyUser', colours: { accent: '#abcdef' }, fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } }, icons: {} });
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
  );
});

test('JSON mode hides the row affordances but keeps the toolbar controls', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('a reset that cannot be written says so, and says nothing changed (FR-006a, SC-012)', { tag: ['@extended', '@prefs'] }, async () => {
  /*
   * ITS OWN APP (034 FR-045). This test replaces settings.json with a NON-EMPTY DIRECTORY so the
   * atomic commit's rename fails. That deliberately corrupts the one resource every other test in
   * this file shares, and one Electron launch is a fair price for not making the file's remaining
   * tests depend on the repair at the bottom of this one having worked.
   */
  const ownCfgRoot = freshCfgRoot();
  await runOwnApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await prefs.getByTestId('control-editor.autoSave').click();
      await expect(prefs.getByTestId('setting-reset-editor.autoSave')).toBeEnabled();
      await expect.poll(() => readSettings(ownCfgRoot)?.editor?.autoSave).toBe(true);

      // Make settings.json unwritable the only way Windows reliably allows: replace it with a
      // NON-EMPTY directory, so the atomic commit's rename fails and feature 010 rolls back.
      const settingsPath = join(ownCfgRoot, 'settings.json');
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
    { env: { THRONG_CONFIG_ROOT: ownCfgRoot } },
  );
});

test('a reset performed in JSON mode refreshes the visible document (FR-013b)', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('resets are idempotent, and the four scopes are distinguishable (SC-003, SC-008, SC-011)', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});
