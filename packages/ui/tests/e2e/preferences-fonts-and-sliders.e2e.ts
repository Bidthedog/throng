import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FILE_OP_TIMEOUT_MS, openApp, settle, setSlider, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

/** Open the preferences window on a tab, through the cog — the same route every prefs suite uses. */
async function openPrefs(app: ElectronApplication, win: Page, tab: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

/**
 * 018 follow-up — the eight things that were wrong when the feature was actually driven.
 *
 * Every one of these was found by USING the application rather than by reading the spec, which is the
 * point of shipping something a person can open. The spec said the theme editor was complete; it was
 * complete against a model that quietly offered a role only the attributes its author had happened to
 * pin, and pinned a numeric weight that no ordinary font can draw.
 */

const cfgRoots: string[] = [];

function freshCfg(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  cfgRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * None of the six tests seeded anything before launch. Five drag a slider or read a control and then
 * check settings.json or the active theme file — writes to the CONTENTS of a config root, which
 * `restoreConfigRoot` undoes. The sixth only opens the cog menu, and now closes it again: throng
 * dismisses menus on blur, so a menu left standing would swallow the next test's first click.
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
let cfg: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfg = freshCfg();
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfg } });
  await settle(shared.win);
  // Photograph the root only once first-run seeding has finished — settings, key bindings and every
  // shipped theme. A partial snapshot would have every later restore DELETE whatever arrived late.
  await expect.poll(() => configRootSeeded(cfg), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfg);
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

function readSettings(cfg: string): Record<string, never> & { editor: { maxOpenFileBytes: number } } {
  return JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8')) as never;
}

function readTheme(cfg: string, name: string): { typography?: Record<string, Record<string, unknown>> } {
  const file = join(cfg, 'themes', `${name}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as never) : {};
}

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:113` "a menu opens with NOTHING highlighted (the first item is not chosen for you)" →
 * `packages/ui/tests/component/menu-keyboard.test.ts`, "opening a menu chooses nothing for you".
 *
 * It is a PAIR of claims and both halves matter in opposite directions: focus is on the MENU (or the
 * arrows reach nothing and the menu is mouse-only) and on NO ITEM (or Enter is armed before a choice
 * is made, and a user who opened the menu to look has run a command). `always-focus-first` reddens
 * one direction, `nothing-takes-focus` the other.
 *
 * Two cases came down with it that this could not state: the first ArrowDown IS what selects an item
 * — so the absence is a starting state rather than a menu no keyboard can drive — and Enter straight
 * after an open fires nothing, which is the consequence the rule exists to prevent, asserted as
 * itself rather than through a proxy for it.
 *
 * The Escape at the end went too. It existed because this file shares one app and a menu left
 * standing would be dismissed by the NEXT test's first click, silently swallowing it. That hazard is
 * a property of a shared app and does not exist one layer down.
 */
test('the max open file size is a slider that moves in 5 MB steps', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      const slider = prefs.getByTestId('control-editor.maxOpenFileBytes-slider');
      await expect(slider).toBeVisible();
      const MiB = 1024 * 1024;
      // The step and minimum themselves are asserted on the shared control at the component layer
      // (`tests/component/preferences-number-control.test.ts`, "carries the descriptor bounds on the
      // slider"). What is left here is the half that layer cannot see: a real drag reaching disk.

      // Drag it, and the value that lands on disk is a whole number of 5 MB steps.
      await setSlider(slider, String(25 * MiB));
      await expect.poll(() => readSettings(cfg).editor.maxOpenFileBytes, { timeout: FILE_OP_TIMEOUT_MS }).toBe(25 * MiB);
    },
  );
});

/*
 * MOVED to `packages/ui/tests/component/preferences-number-control.test.ts` (034 FR-045):
 * "a slider writes when you LET GO — not on every pixel, and not on a timer".
 *
 * The claim is two claims, and this file could not separate them because it only ever looked at
 * settings.json afterwards: the field must follow the thumb IMMEDIATELY, and the write must happen
 * only when the gesture ends. The component test names them separately — a `change` mid-drag reaches
 * the field and NOT the commit callback, a `pointerup` reaches the commit callback exactly once.
 *
 * The two attribute assertions that used to sit in the two tests below went the same way: a control
 * carrying its descriptor's `min`, `max` and `step` is a property of the shared control, not of the
 * screen it happens to appear on. Both tests remain, narrowed to the half that needs a real app —
 * a drag that lands a value on disk.
 */
/*
 * MOVED to `packages/ui/tests/component/preferences-themes-tab.test.ts` (034 FR-045):
 *   - "EVERY typography role offers EVERY attribute — including the two it never had"
 *
 * It asserted `toHaveCount(1)` on seven controls and `toHaveCount(0)` on five, and did it through
 * an Electron launch and a second window. The registry behind it (`themeEditableTokens`,
 * `theme-metadata.ts:412`) is pure and separately tested — but a descriptor existing is NOT a
 * control being rendered, and the failure mode this test guards is exactly that gap: a descriptor
 * whose `control` has no case in the dispatch falls through to the default arm and draws a text
 * box showing nonsense. Nothing throws and nothing fails a type check. Which is the kind of thing
 * a DOM can look at, and a registry test cannot.
 *
 * Split into three there, so the two ABSENCE claims each get their own positive control on the
 * same registry — without one, "the dialog role is gone" passes in a tab that rendered nothing.
 *
 * WHAT DID NOT MOVE: the two tests either side of this one. Both drag a real slider and then read
 * either the theme file (`typography.tab.weight`) or `getComputedStyle('.prefs-root').fontSize`.
 * The 100-900 scale itself is a descriptor bound and is asserted on the shared control at the
 * component layer already; what is left in them is the half that needs a real app.
 *
 * ANTI-VACUITY CONTROL: aliasing `ConfirmProvider` to `Fragment` in the component file makes
 * `useConfirm()` throw, `ThemesTab` renders nothing, and ALL 11 tests fail. Run, and failing.
 */

test('a role WEIGHT is a slider on the real 100-900 scale (021 follow-up)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // The old Bold CHECKBOX could render a role lighter than a sibling when the theme's bold weight was
      // set low; it is now a slider that says exactly what weight it will apply.
      const weight = prefs.getByTestId('control-typography.tab.weight-slider');
      await expect(weight).toBeVisible();
      // The 100–900 scale is the DESCRIPTOR's, and the control carrying its descriptor's bounds is
      // asserted at the component layer. What matters here is that the role is a slider at all — it
      // was a Bold CHECKBOX, which could render a role lighter than a sibling — and that dragging it
      // writes the weight into the theme file.
      await setSlider(weight, '700');
      await expect.poll(() => readTheme(cfg, 'throng').typography?.tab?.weight, { timeout: FILE_OP_TIMEOUT_MS }).toBe(700);

      // The base weights remain sliders on the same scale — what every unset role inherits.
      await expect(prefs.getByTestId('control-fonts.weights.bold-slider')).toHaveCount(1);
    },
  );
});

test('the preferences window inherits the BASE application font (no separate dialog font)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // The `dialog` role was retired: the preferences window is no longer themed apart from the app, so
      // changing the BASE font size moves the window with everything else.
      await setSlider(prefs.getByTestId('control-fonts.baseSizePx-slider'), '18');
      await expect
        .poll(() =>
          prefs.evaluate(() => {
            const root = document.querySelector('.prefs-root');
            return root ? getComputedStyle(root).fontSize : '';
          }),
        )
        .toBe('18px');
    },
  );
});

test('Revert this theme undoes THIS SITTING’s edits, and only offers itself when there are any', { tag: ['@extended', '@prefs'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemesTab(app, win);
      // Nothing has changed, so there is nothing to revert — and a no-op affordance is noise.
      await expect(prefs.getByTestId('theme-revert')).toHaveCount(0);

      const size = prefs.getByTestId('control-fonts.baseSizePx');
      const original = await size.inputValue();
      expect(original).not.toBe('20');

      await setSlider(prefs.getByTestId('control-fonts.baseSizePx-slider'), '20');
      await expect
        .poll(() => (readTheme(cfg, 'throng') as { fonts?: { baseSizePx?: number } }).fonts?.baseSizePx, {
          timeout: 5000,
        })
        .toBe(20);

      // NOW it is offered.
      await prefs.getByTestId('theme-revert').click();
      await expect(prefs.getByTestId('theme-confirm-dialog')).toBeVisible();
      await prefs.getByTestId('theme-confirm-yes').click();

      // Back to what the window opened with — not to the shipped default, which is what Restore means.
      await expect.poll(() => size.inputValue(), { timeout: 5000 }).toBe(original);
    },
  );
});

/** Open Preferences on the Themes tab. */
async function openThemesTab(app: ElectronApplication, win: Page): Promise<Page> {
  const prefs = await openPrefs(app, win, 'themes');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}
