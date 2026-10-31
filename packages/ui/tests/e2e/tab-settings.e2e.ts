/**
 * 031 US3/US4 — the Tabs preferences, and the picker's binding (#225, #227).
 *
 * Three settings and one chord, all of which exist to be CHANGED by a person who never opens a JSON
 * file. contracts/tab-strip.md T6 requires the binding to appear in the Key Bindings editor and be
 * rebindable; the settings side is FR-030/FR-047 plus the bounds declared in
 * `settings-metadata.ts` — which, since #227, are the ONLY statement of those bounds anywhere.
 * There is no second clamp in `app-settings.ts` to fall back on, so a range that is wrong here is
 * wrong everywhere, and that is exactly why it is asserted from the rendered control.
 *
 * This spec drives the preferences WINDOW, so it belongs in the serial tier: a second headed app
 * stealing focus closes menus and dialogs underneath it.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { shippedBindingsFor } from '@throng/core';
import { FILE_OP_TIMEOUT_MS, openApp, settle, setSlider, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-tabsettings-'));
  cfgRoots.push(dir);
  return dir;
}
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * None of the tests seeds anything; each drives the preferences window and reads settings.json or
 * keybindings.json back. The editing test drags `maxNameLength` to 30, so the root is restored between
 * tests and each opens on a pristine root exactly as it did with its own launch.
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

function readSettings(cfgRoot: string): { tabs?: Record<string, number> } | undefined {
  const file = join(cfgRoot, 'settings.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as { tabs?: Record<string, number> };
}

function readBindings(cfgRoot: string): Record<string, string[]> | undefined {
  const file = join(cfgRoot, 'keybindings.json');
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as { bindings: Record<string, string[]> }).bindings;
}

async function openPreferences(
  app: ElectronApplication,
  win: Page,
  tab: 'settings' | 'keybindings',
): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId(`${tab}-tab`)).toBeVisible();
  return prefs;
}

/** Dispatch a synthetic chord on the prefs window (never let a reserved combo reach the OS). */
async function sendChord(prefs: Page, key: string): Promise<void> {
  await prefs.evaluate((k) => {
    const init = { key: k, bubbles: true } as KeyboardEventInit;
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
  }, key);
}

/*
 * MOVED DOWN: "T057 — the Tabs section exposes every setting, with their ranges and defaults". Every
 * claim it made from the rendered form has a cheaper owner:
 *
 *   - each Tabs setting's group, control, range, step and shipped default —
 *     `packages/core/tests/unit/tabs-settings.test.ts` (including `behaviour.tabHoverActivateMs`,
 *     filed under Tabs though its key does not start `tabs.`);
 *   - a slider rendering the min, max and step its descriptor declares —
 *     `packages/ui/tests/component/preferences-number-control.test.ts`;
 *   - the settings form grouping controls by their metadata group —
 *     `packages/ui/tests/component/settings-tab-subgroups.test.ts`;
 *   - the shipped defaults written to disk at first run —
 *     `packages/core/tests/contract/shipped-defaults-fidelity.contract.test.ts`.
 */

test('T057 — each tab setting is editable by slider and by field, and persists', { tag: ['@extended', '@window'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openPreferences(app, win, 'settings');

      // Drag the scroll duration to a value on its step grid.
      await setSlider(prefs.getByTestId('control-tabs.smoothScrollMs-slider'), '1500');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.smoothScrollMs, { timeout: FILE_OP_TIMEOUT_MS }).toBe(1500);
      // `1,500`, grouped — REVERSED since this test was written. 018 exempted values under five
      // digits, on the reasoning quoted here before: a four-digit millisecond delay rendered with a
      // separator reads as a typo rather than as a kindness. Constitution 4.5.0 drops that floor,
      // because a threshold makes a COLUMN inconsistent — these tab delays sit directly beside
      // values that do cross it, and a separator appearing halfway up a column teaches the reader
      // it means something when it means only that one value grew a digit. The STORED value above
      // is still plain, which is the half that was never in question.
      await expect(prefs.getByTestId('control-tabs.smoothScrollMs')).toHaveValue('1,500');

      // Type the arming delay instead: the field and the slider drive one value.
      const arming = prefs.getByTestId('control-tabs.closeArmingDelayMs');
      await arming.fill('800');
      await arming.press('Enter');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.closeArmingDelayMs, { timeout: FILE_OP_TIMEOUT_MS }).toBe(800);
      await expect.poll(() => prefs.getByTestId('control-tabs.closeArmingDelayMs-slider').inputValue()).toBe(
        '800',
      );

      // And the name limit, whose step of 2 exists so that 64 stays reachable from a minimum of 10.
      await setSlider(prefs.getByTestId('control-tabs.maxNameLength-slider'), '30');
      await expect.poll(() => readSettings(cfgRoot)?.tabs?.maxNameLength, { timeout: FILE_OP_TIMEOUT_MS }).toBe(30);
    },
  );
});

/*
 * MOVED DOWN (044 T163e): "T057 — a value outside a declared range is refused, and the last valid
 * one stands". A number control's validation and a value that is therefore never written. Held below
 * E2E, each observed failing against a broken implementation before this was deleted:
 *
 *   - the field refuses a value above the maximum and below the minimum, SHOWS the refusal, and
 *     commits nothing — `packages/ui/tests/component/preferences-number-control.test.ts` ("refuses a
 *     value above the declared maximum…", and "refuses a value below the declared minimum, and says
 *     so", added for this move);
 *   - the Tabs settings declare those ranges (maxNameLength's minimum of 10 is what refused `4`), and
 *     a value outside them on disk is clamped back — `packages/core/tests/unit/tabs-settings.test.ts`.
 *
 * The file header's account of "the third" test keeping `maxNameLength` at 64 describes this one.
 */

test('T057 — tabs.openPicker appears in the Key Bindings editor and is rebindable (T6)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openPreferences(app, win, 'keybindings');

      // Listed, under the same "Tabs" heading the Settings editor uses, with its shipped chord and a
      // scope that says it works everywhere — which is what T5's "at any tab count, from anywhere"
      // looks like from the editor's side.
      const row = prefs.getByTestId('binding-tabs.openPicker');
      await expect(row).toBeVisible();
      await expect(
        prefs.getByTestId('keybindings-group-Tabs').getByTestId('binding-tabs.openPicker'),
      ).toHaveCount(1);
      // Read from the shipped default (Ctrl+Shift+Alt+T since 046 FR-102) rather than spelled.
      const shipped = shippedBindingsFor().bindings['tabs.openPicker']?.[0];
      expect(shipped, 'tabs.openPicker ships no chord').toBeDefined();
      await expect(prefs.getByTestId('binding-tabs.openPicker-chord')).toContainText(shipped as string);
      await expect(prefs.getByTestId('binding-tabs.openPicker-scope')).toHaveText('Everywhere');

      // REBINDABLE — capture is additive, so the shipped chord survives beside the new one.
      await row.dblclick();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      await sendChord(prefs, 'F9');
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect
        .poll(() => readBindings(cfgRoot)?.['tabs.openPicker'])
        .toEqual([shipped, 'F9']);

      // …and the new chord is what the editor now shows.
      await expect(prefs.getByTestId('binding-tabs.openPicker-chord')).toContainText('F9');
    },
  );
});
