import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { openApp, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

/**
 * Issue #76 — per-token Reset and Revert on the Themes tab.
 *
 * The Themes tab used to decline reset/revert wholesale (015 FR-013, on the grounds that 014's
 * per-theme "Restore to default" already writes the theme file). #76 supersedes that for individual
 * tokens: a per-token reset is a DIFFERENT write scope (one token vs the whole theme) and takes the
 * editor's own token-write path, so it does not reintroduce the duplicate-write hazard FR-013
 * guarded against. Reset restores the SHIPPED value; Revert restores the value the window OPENED
 * with; both match Settings and Key Bindings.
 */
const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-thmreset-'));
  cfgRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Neither test ever passed `freshCfgRoot` a seed — the parameter was dead. Both edit `colours.accent`
 * on the active built-in theme and then undo it through the control under test; the restore is what
 * guarantees the SECOND test still opens on the shipped value, which is the baseline its whole claim
 * rests on.
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

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-themes').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

const KEY = 'colours.accent';
const control = (prefs: Page) => prefs.getByTestId(`control-${KEY}-hex`);
const reset = (prefs: Page) => prefs.getByTestId(`theme-reset-${KEY}`);
const revert = (prefs: Page) => prefs.getByTestId(`theme-revert-${KEY}`);

test('Reset returns a built-in theme token to its shipped value (#76)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win); // a built-in (throng) is active by default
      const shipped = await control(prefs).inputValue();
      expect(shipped).toMatch(/^#/);

      // Unedited: at its shipped value, so Reset does not apply (it is present but disabled).
      await expect(reset(prefs)).toBeDisabled();

      // Edit the token → now it is overridden, so Reset lights up.
      await control(prefs).fill('#abcdef');
      await expect(reset(prefs)).toBeEnabled();

      // Reset → back to the shipped value, and Reset goes quiet again.
      await reset(prefs).click();
      await expect(control(prefs)).toHaveValue(shipped);
      await expect(reset(prefs)).toBeDisabled();
    },
  );
});

test('Revert returns a token to the value the window opened with (#76)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      const onEntry = await control(prefs).inputValue();

      // Nothing changed yet → Revert does not apply.
      await expect(revert(prefs)).toBeDisabled();

      await control(prefs).fill('#0f0f0f');
      await expect(revert(prefs)).toBeEnabled();

      // Revert → back to the on-entry value, and Revert goes quiet.
      await revert(prefs).click();
      await expect(control(prefs)).toHaveValue(onEntry);
      await expect(revert(prefs)).toBeDisabled();
    },
  );
});

/*
 * MOVED to `packages/ui/tests/component/preferences-row-actions.test.ts` (034 FR-045):
 *   - "a CUSTOM theme declines Reset (no shipped baseline) but still offers Revert (#76)"
 *
 * DECLINING is an omitted handler, and the component renders nothing for one — so "absent
 * because it will never apply here" versus "greyed because it does not apply yet" is visible
 * without a window. What stays in this file is what Reset and Revert actually DO, which
 * differ only in which baseline they read: the shipped value against the value the window
 * opened with. A component handed an `onReset` callback cannot tell you which it is wired to.
 */
