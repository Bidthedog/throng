import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

// US2 (config half) / Plan Phase B (FR-010/010a/011/012): the Flavour dropdown is
// real — machine-detected built-ins ∪ user-defined flavours from settings.json —
// and Shell Arguments pre-fills/updates with the chosen flavour's default. No
// terminal launches yet (that is Phase C).
//
// FR-024 (batch-2 robust detection: well-known path → PATH → registry, incl.
// non-default/portable Git installs, with no false positives) is NOT E2E'd here:
// the built app uses the real machine's registry/PATH, which a test must not
// mutate. That ordered resolution is instead covered deterministically by the pure
// resolver unit test (packages/core/tests/unit/terminal-resolve-shell.test.ts) and
// the fake-resolver cases in the WindowsShellDetection contract test
// (packages/platform-windows/tests/contract/windows-shell-detection.contract.test.ts).

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. Test 2's `writeSettingsAtomic` (:70-76) is a hot-reload write
 * THROUGH the running app, which is the mechanism under test.
 *
 * NO SHELL IS EVER STARTED here — neither test clicks `panel-type-confirm`, so both only open the
 * type form and read the dropdown. That is what separates this file from every other `terminal-*`
 * one, where a live shell outliving its test is the blocker.
 *
 * Left behind: `terminals.flavours` carrying `my-wsl`, and two panels sitting in the type form. The
 * restore removes the flavour, which is what keeps test 2's opening assertion — that `my-wsl` is
 * ABSENT (:60) — true in any order rather than only while it runs second.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one config root.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let sharedCfg: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  sharedCfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: sharedCfg } });
  await settle(shared.win);
  // Only once first-run seeding has finished — settings, key bindings and every shipped theme. A
  // snapshot taken mid-seed photographs a partial root, and every restore after it would DELETE
  // whatever arrived late.
  await expect.poll(() => configRootSeeded(sharedCfg), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(sharedCfg);
});

test.afterEach(async () => {
  // Restore, wait, re-diff, restore again — and throw NAMING the paths if it will not converge,
  // rather than handing a poisoned root to the next test.
  await settleConfigRoot(baseline, 5_000);
});

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(sharedCfg);
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

test('the Flavour dropdown is populated from the machine and Shell Arguments follows the flavour', { tag: ['@extended', '@terminal'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Flavours', 'C:/c/flavours');
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');

    const flavour = win.getByTestId('terminal-flavour');
    await expect(flavour).toBeVisible();

    // Command Prompt is always present on Windows → it is a detected built-in.
    const values = await flavour
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(values).toContain('cmd');

    // Selecting a flavour fills Shell Arguments with that flavour's default (FR-011/012).
    await flavour.selectOption('cmd');
    await expect(win.getByTestId('terminal-shell-arguments')).toHaveValue('/K');

    // Changing the flavour updates Shell Arguments again (FR-012).
    if (values.includes('windows-powershell')) {
      await flavour.selectOption('windows-powershell');
      await expect(win.getByTestId('terminal-shell-arguments')).toHaveValue('-NoLogo');
    }
  });
});

test('a user-defined flavour added to settings.json appears in the dropdown (hot-reload, FR-010a)', { tag: ['@extended', '@terminal'] }, async () => {
  await runApp(
    async (_app, win) => {
      await createProject(win, 'UserFlav', 'C:/c/userflav');
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      const flavour = win.getByTestId('terminal-flavour');
      await expect(flavour).toBeVisible();

      // Not present until the user adds it.
      await expect(flavour.locator('option[value="my-wsl"]')).toHaveCount(0);

      /*
       * Add a user flavour to settings.json → config hot-reload → it appears.
       *
       * ATOMICALLY (032 FR-013, G8): the app is running and watching this file. `writeFileSync`
       * truncates before it fills, so the watcher can wake on the empty file, parse nothing,
       * broadcast the shipped defaults, and never look again — the flavour is lost rather than
       * late, and the spec fails claiming the dropdown does not honour user flavours.
       */
      writeSettingsAtomic(sharedCfg, {
        terminals: {
          flavours: [
            { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultShellArguments: '--cd ~' },
          ],
        },
      });
      await expect(flavour.locator('option[value="my-wsl"]')).toHaveCount(1);

      // And it carries its own default Shell Arguments.
      await flavour.selectOption('my-wsl');
      await expect(win.getByTestId('terminal-shell-arguments')).toHaveValue('--cd ~');
    },
  );
});
