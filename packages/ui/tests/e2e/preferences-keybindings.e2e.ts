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
 * US3 (007 Phase D) + H2 (2026-07-08): the Key Bindings tab rebinds a shortcut by
 * capturing a chord — capture is ADDITIVE (multiple chords per action, FR-033), a
 * bare single non-excluded key is bindable (FR-033a), an excluded key/reserved OS
 * combo is surfaced as unavailable (FR-032a/033a), individual chords are removable
 * (FR-033b), and a conflict warns + Reassign moves the chord from the other action
 * while keeping this action's existing chords (additive, FR-034). Chords are
 * dispatched as synthetic DOM key events so reserved combos never reach the OS.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-kb-'));
  cfgRoots.push(dir);
  return dir;
}
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * Not one of the seven tests here needs anything on disk BEFORE the app starts — every one called
 * `freshCfgRoot()` with no arguments. The isolated root was for write ISOLATION between tests, and
 * that is what `restoreConfigRoot` provides: the root is photographed once the app has seeded it and
 * put back after every test.
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

/** Dispatch a synthetic chord (keydown then keyup) on the prefs window. */

/*
 * FOUR TESTS REMOVED (035 T034) — now `packages/ui/tests/component/preferences-keybindings-tab.test.ts`:
 *
 *   - "double-click captures a chord and ADDS it"
 *   - "a single key binds (no modifier required)"
 *   - "a chord pill removes just that binding (FR-033b)"
 *   - "a conflicting chord warns and Reassign moves it from the other action"
 *
 * ── WHY THEY COULD COME DOWN NOW AND NOT BEFORE ──
 *
 * The component file had already recorded a reason for keeping them: they assert
 * `keybindings.json`, and *"whether that map survives the write path is the config store's claim,
 * not this component's"*. That decomposition was right, and it left the OTHER half homeless — the
 * store's claim is proven (`contract/config-write-patch.contract.test.ts`, and
 * `component/config-store-adoption.test.ts` for adoption), but that the TAB hands the write path
 * the right map was asserted nowhere at all.
 *
 * So the replacements assert what the tab hands over, not what lands in the file, and two of them
 * are stronger than what they replace:
 *
 *   - the remove test asserts every OTHER action is byte-identical to the shipped table, where the
 *     E2E read one key out of the file — a remove that rebuilds from a stale copy takes other
 *     actions with it, and reading one key cannot see that;
 *   - Reassign asserts both halves in ONE document (added to the new owner, gone from the old),
 *     where the E2E polled the file twice and could have read a different write each time;
 *   - and a new test asserts the document VERSION survives, which no assertion on `bindings` can
 *     see and which no test made before.
 *
 * Red-proven against four mutations: no-write (4 red), drop-version (1), remove-clobbers (1), and
 * replace-not-add at the modal's `applyAdd` (2 here, 2 in the modal's own file).
 *
 * The test BELOW stays. It reads `getComputedStyle(el).userSelect` for a value INHERITED from the
 * application stylesheet, and jsdom applies no real cascade — asserting it at the component layer
 * would be asserting about jsdom (034 FR-049). Its tag already says so: `@reserve:layout`.
 */
test('the capture ("Bind") dialog does not allow text selection', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      await prefs.getByTestId('binding-view.toggleExplorer').dblclick();
      const modal = prefs.getByTestId('capture-modal');
      await expect(modal).toBeVisible();
      // Chrome/dialog text is non-selectable app-wide (inherited from body).
      expect(await modal.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
      expect(
        await prefs
          .getByTestId('capture-modal')
          .locator('.capture-modal__title')
          .evaluate((el) => getComputedStyle(el).userSelect),
      ).toBe('none');
    },
  );
});


/*
 * MOVED to `packages/ui/tests/component/preferences-capture-modal.test.ts` (034 FR-045):
 *   - "an excluded single key (Space) is rejected and not saved"
 *   - "a reserved OS combo is surfaced as unavailable and not saved"
 *
 * Both dispatched a synthetic KeyboardEvent at `window` and then asserted that an error appeared,
 * the modal stayed open, and nothing was saved. The first two are the modal deciding; the third
 * follows from them, because a refused chord is never handed to `onApply` and so there is nothing
 * for the parent to write. Two Electron launches for a validation rule.
 */

/*
 * MOVED to `packages/ui/tests/component/preferences-keybindings-tab.test.ts` (034 FR-045):
 *   - "every command shows WHERE it is live, and Ctrl+X coexists on two of them (FR-017b0)"
 *   - "a REAL clash — scopes that intersect — still warns and never silently steals the chord"
 *
 * Neither read a file. The first asserted the TEXT of the scope pills for four commands, the
 * chord text for two, and that no conflict was raised anywhere on the tab. The second
 * double-clicked a row, dispatched a synthetic KeyboardEvent at `window` — which is what a
 * component test does natively — and then read two rows back. Both spent an Electron launch and
 * a second BrowserWindow on a DOM.
 *
 * The tab renders from `DEFAULT_KEYBINDINGS` and `COMMAND_SCOPES` with three real providers and
 * no bridge, so what the component version says about the shipped command table is the same
 * statement this file was making — against the same data.
 *
 * STRONGER THERE THAN HERE: the clash test now also asserts that the conflict names
 * `editor.cutLine` and NOT `file.cut`. Both hold Ctrl+X; only one of them intersects the editor
 * scope. That is the whole point of a scope-aware `findConflict`, and this file never checked it —
 * it only checked that SOME warning appeared. Red-proved by deleting the `scopesIntersect` guard
 * in `chord-capture.ts:154`, which turns the named owner into `file.cut`.
 *
 * WHAT STAYS HERE, and none of it is a near miss:
 *   - every test that reads `keybindings.json` — capture-adds-a-chord, a bare single key, a pill
 *     removing just its own chord, and Reassign moving a chord between two actions. The tab hands
 *     `writeConfig` a map; whether that map survives the write path is the config store’s claim.
 *   - the two `user-select: none` assertions, which read a value INHERITED from the application
 *     stylesheet. jsdom applies no real cascade, so asserting them there would be asserting about
 *     jsdom — 034 FR-049 exactly.
 *
 * ANTI-VACUITY CONTROL: aliasing `ResetNoticeProvider` to `Fragment` in the component file makes
 * `useResetNotice()` throw, the tab renders nothing, and ALL 12 tests fail. Run, and failing.
 */
