import { mkdtempSync, readFileSync } from 'node:fs';
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

function readBindings(cfgRoot: string): Record<string, string[]> | null {
  try {
    return JSON.parse(readFileSync(join(cfgRoot, 'keybindings.json'), 'utf8')).bindings;
  } catch {
    return null;
  }
}

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
async function sendChord(
  prefs: Page,
  key: string,
  mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
): Promise<void> {
  await prefs.evaluate(
    ({ key: k, mods: m }) => {
      const init = { key: k, bubbles: true, ...m } as KeyboardEventInit;
      window.dispatchEvent(new KeyboardEvent('keydown', init));
      window.dispatchEvent(new KeyboardEvent('keyup', init));
    },
    { key, mods },
  );
}

test('double-click captures a chord and ADDS it (multiple chords per action)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      await prefs.getByTestId('binding-view.toggleProjects').dblclick();
      await expect(prefs.getByTestId('capture-modal')).toBeVisible();
      await sendChord(prefs, 'k', { ctrlKey: true }); // Ctrl+K added to the default Ctrl+Alt+B
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleProjects'])
        .toEqual(['Ctrl+Alt+B', 'Ctrl+K']); // added, not replaced
    },
  );
});

test('a single key binds (no modifier required); double-click does not select text', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      const row = prefs.getByTestId('binding-view.toggleExplorer');
      // Double-clicking the row must not highlight its text (FR-031).
      expect(await row.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
      await row.dblclick();
      await sendChord(prefs, 'F7'); // a bare single key is now bindable (F7 is unbound by default)
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleExplorer'])
        .toEqual(['Ctrl+Alt+N', 'F7']); // added to the default, not replaced
    },
  );
});

test('the capture ("Bind") dialog does not allow text selection', { tag: ['@extended', '@prefs'] }, async () => {
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

test('a chord pill removes just that binding (FR-033b)', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      // Add Ctrl+K so view.toggleProjects has two chords, then remove the first.
      await prefs.getByTestId('binding-view.toggleProjects').dblclick();
      await sendChord(prefs, 'k', { ctrlKey: true });
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleProjects'])
        .toEqual(['Ctrl+Alt+B', 'Ctrl+K']);
      // Wait for the renderer to reflect both chords (the live-reload round-trip) so
      // the remove acts on the current two-pill state, not the stale single-pill one.
      await expect(prefs.getByTestId('binding-view.toggleProjects-pill-1')).toBeVisible();
      await prefs.getByTestId('binding-view.toggleProjects-remove-0').click(); // remove Ctrl+Alt+B
      await expect
        .poll(() => readBindings(cfgRoot)?.['view.toggleProjects'])
        .toEqual(['Ctrl+K']);
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
test('a conflicting chord warns and Reassign moves it from the other action', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openKeybindings(app, win);
      // Rebind view.toggleExplorer to Ctrl+Alt+B — already bound to view.toggleProjects.
      await prefs.getByTestId('binding-view.toggleExplorer').dblclick();
      // 026 / #165 — must be the chord the OTHER action actually holds, or there is no conflict to
      // detect and this test silently stops testing the conflict path.
      await sendChord(prefs, 'b', { ctrlKey: true, altKey: true });
      await expect(prefs.getByTestId('capture-conflict')).toBeVisible();
      await prefs.getByTestId('capture-reassign').click();
      await expect(prefs.getByTestId('capture-modal')).toBeHidden();
      // Reassign is additive here (FR-033/034): Ctrl+Alt+B is added to view.toggleExplorer's
      // existing chord(s), not a replacement.
      await expect.poll(() => readBindings(cfgRoot)?.['view.toggleExplorer']).toEqual(['Ctrl+Alt+N', 'Ctrl+Alt+B']);
      // Removed from the previous owner.
      await expect.poll(() => readBindings(cfgRoot)?.['view.toggleProjects']).toEqual([]);
    },
  );
});

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
