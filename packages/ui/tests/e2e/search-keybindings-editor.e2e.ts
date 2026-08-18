import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  openApp,
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
import { closePrefsWindow } from './helpers/prefs-window.js';

// 013 SC-006 — every search and scrollback command is DISCOVERABLE and REBINDABLE in the
// visual Key Bindings editor. The core completeness test already proves each action has a
// descriptor; this proves the descriptors actually reach the user's editor and that one of
// the new commands really can be rebound end-to-end.


/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch: each `freshCfgRoot()` took no arguments, so the root was write
 * isolation for the read-back at :92, not state the app parsed at startup.
 *
 * The blocker was the SINGLETON preferences window. `openKeybindings` (:44-53) is the
 * `Promise.all([app.waitForEvent('window'), click])` shape, and `openPreferences` focuses the
 * existing window rather than creating one (`preferences-window.ts:111`) — so under a shared app the
 * second call fires no `window` event and waits out its whole budget. Closing it per test is what
 * keeps both tests reading exactly as they did.
 *
 * Left behind: `search.find` rebound to `['Ctrl+F', 'Ctrl+Shift+K']` in keybindings.json, and the
 * preferences window open. The `afterEach` returns both — and the restore is what lets test 2 reach
 * `search.find` FROM its shipped default in any order.
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
  sharedCfg = mkdtempSync(join(tmpdir(), 'throng-cfg-search-kb-'));
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: sharedCfg } });
  await settle(shared.win);
  // Only once first-run seeding has finished — settings, key bindings and every shipped theme. A
  // snapshot taken mid-seed photographs a partial root, and every restore after it would DELETE
  // whatever arrived late.
  await expect.poll(() => configRootSeeded(sharedCfg), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(sharedCfg);
});

test.afterEach(async () => {
  // Close FIRST. The preferences window is a singleton, so one left standing makes the next
  // `waitForEvent('window')` wait out its whole budget — and a restore landing under an open
  // window raises `json-external-change` at a test that never asked for it.
  await closePrefsWindow(shared.app);
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

const SEARCH_ACTIONS = [
  'search.find',
  'search.findNext',
  'search.findPrevious',
  'search.close',
  'search.replace',
  'search.replaceCurrent',
  'search.replaceAll',
];

const SCROLLBACK_ACTIONS = [
  'terminal.scrollLineUp',
  'terminal.scrollLineDown',
  'terminal.scrollPageUp',
  'terminal.scrollPageDown',
  'terminal.scrollToTop',
  'terminal.scrollToBottom',
];

async function openKeybindings(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-keybindings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('keybindings-tab')).toBeVisible();
  return prefs;
}

test('every search & scrollback command is listed in the Key Bindings editor (SC-006)', { tag: ['@extended', '@editor'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);

      for (const action of [...SEARCH_ACTIONS, ...SCROLLBACK_ACTIONS]) {
        await expect(
          prefs.getByTestId(`binding-${action}`),
          `${action} is not exposed in the Key Bindings editor`,
        ).toBeVisible();
      }
    },
  );
});

test('a search command can actually be rebound (FR-017)', { tag: ['@extended', '@editor'] }, async () => {
  const cfgRoot = sharedCfg;
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);

      await prefs.getByTestId('binding-search.find').dblclick();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      await prefs.evaluate(() => {
        const init: KeyboardEventInit = { key: 'k', bubbles: true, ctrlKey: true, shiftKey: true };
        window.dispatchEvent(new KeyboardEvent('keydown', init));
        window.dispatchEvent(new KeyboardEvent('keyup', init));
      });
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();

      // The new chord is written to the user's keybindings file, alongside the default.
      await expect
        .poll(
          () => {
            try {
              const raw = readFileSync(join(cfgRoot, 'keybindings.json'), 'utf8');
              return (JSON.parse(raw).bindings as Record<string, string[]>)['search.find'];
            } catch {
              return undefined;
            }
          },
          { timeout: 8000 },
        )
        .toEqual(['Ctrl+F', 'Ctrl+Shift+K']);
    },
  );
});
