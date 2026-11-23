import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { FILE_OP_TIMEOUT_MS, openApp, settle, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

/**
 * 018 / US4 — the themed colour picker (FR-020 … FR-026).
 *
 * The control this replaces opened the OPERATING SYSTEM'S OWN colour dialog — a light-grey panel in
 * system fonts, in the middle of a fully-themed dark application, that no stylesheet could reach. It
 * sat on the control the Themes editor is BUILT FROM: every colour token in the app went through it.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cp-'));
  cfgRoots.push(dir);
  return dir;
}
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * All five tests seeded nothing: each launched an app purely to open the Themes tab and drive the
 * colour control on it. Three only LOOK; two edit `colours.accent`, which is a change to the
 * contents of a config root and is what `restoreConfigRoot` undoes — and the second of the two
 * reads the shipped accent as its baseline before editing, so the restore is what keeps it honest.
 *
 * The two viewport tests leave a picker OPEN. That costs nothing here: the preferences window is
 * destroyed on close, so no popup survives into the next test.
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
  return prefs;
}

function readTheme(cfgRoot: string, name = 'throng'): Record<string, string> | undefined {
  const file = join(cfgRoot, 'themes', `${name}.json`);
  if (!existsSync(file)) return undefined;
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { colours?: Record<string, string> };
  return doc.colours;
}

/*
 * MOVED to `packages/ui/tests/component/colour-field.test.ts` (034 FR-045):
 * "an INVALID colour is rejected, the last valid one stands, and the row says so (FR-026)", plus the
 * markup half of the FR-020 test above.
 *
 * `ColourField` and `ColourPicker` are exported and take props only — `value`, `onCommit`,
 * `testId`, `clearable` — with `Icon` (ConfigContext defaults, no provider) and the pure
 * `clampToViewport` beneath them. So opening a SECOND WINDOW to click a swatch bought nothing that
 * a render does not.
 *
 * Nine component tests replace them, including two the E2E did not make: that no native
 * `<input type="color">` exists with the picker OPEN as well as closed, and that the invalid mark
 * CLEARS when the value is corrected.
 *
 * Red-proved, and two of the mutations were wrong before they were right, which is worth recording:
 *   - `setInvalid(true)` has TWO call sites and a non-global replace hit only the one my test does
 *     not exercise, reporting "not coupled". Global: 2 failed.
 *   - prepending `type="color"` to the first `<input` proved nothing, because JSX prop order lets
 *     the element's own `type` win. Aimed at the real attributes: hex field 4 failed, hue strip 1.
 *     That second one only reddens because the test was strengthened to check the OPEN picker too.
 *
 * WHAT STAYS (now inside the keyboard test below): the viewport checks, which read `boundingBox()` and
 * require the picker to land fully on screen at the right and bottom edges. `clamp-to-viewport.test.ts` proves the FUNCTION
 * clamps; only a real window proves the RENDERED picker, at its real measured size against a real
 * viewport, actually fits — the v5.1.0 real-layout reserve. This migration was nearly over-claimed on
 * exactly that point. Also staying: the live-apply-and-persist test, including that rapid edits
 * compound into ONE write.
 */
test('the picker is fully keyboard-operable, with a visible focus indicator (FR-024)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      /*
       * MERGED (test-suite audit) from three tests that each opened this same Themes window and the same
       * `colours.accent` picker: the THEME-sourced surface (FR-020), the RIGHT-edge fit and the BOTTOM-edge fit
       * (021/FR-036). Only a real window has a cascade and a measured picker against a real viewport, so they stay
       * at E2E — but in one launch. The layout checks run first, while the window is untouched; the arrow keys,
       * which write the theme, come last.
       */
      // The swatch sits near the right edge of the window (right-aligned in its row), so this is also the
      // RIGHT-edge fit: a picker opening straight down from `left: 0` used to run off the right side.
      const swatch = prefs.getByTestId('control-colours.accent');
      await swatch.scrollIntoViewIfNeeded();
      await swatch.click();
      const picker = prefs.getByTestId('control-colours.accent-picker');
      await expect(picker).toBeVisible();
      await expectWithinViewport(prefs, await picker.boundingBox());

      // FR-020: its card takes the dialog surface from the theme. A real value, and not a transparent one — an
      // unset surface computes to `rgba(0, 0, 0, 0)`, which the old `/rgb/` match let through.
      await expect
        .poll(() => picker.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toMatch(/^rgba?\((?!0,\s*0,\s*0,\s*0\))/);
      await prefs.keyboard.press('Escape');
      await expect(picker).toBeHidden();

      // BOTTOM edge: scroll the Themes panel to the bottom and open the LAST swatch — its picker would open off
      // the bottom of the window unless it flips above.
      await prefs.getByTestId('prefs-panel-themes').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const last = prefs.locator('.ctl__colour-swatch').last();
      await last.scrollIntoViewIfNeeded();
      await last.click();
      const bottomPicker = prefs.locator('.colour-picker');
      await expect(bottomPicker).toBeVisible();
      await expectWithinViewport(prefs, await bottomPicker.boundingBox());
      await prefs.keyboard.press('Escape');
      await expect(bottomPicker).toBeHidden();

      // FR-024, from the top again.
      await swatch.scrollIntoViewIfNeeded();
      await swatch.click();

      // It opens with focus in the saturation area, so a keyboard user can begin at once.
      const sv = prefs.getByTestId('control-colours.accent-sv');
      await expect(sv).toBeFocused();

      // Every control shows a focus ring — a roving focus that leaves no visible mark would trade
      // one accessibility defect for another.
      await expect
        .poll(() => sv.evaluate((el) => getComputedStyle(el).outlineStyle))
        .not.toBe('none');

      // The arrows drive it, and the colour actually changes.
      const before = await readTheme(cfgRoot)?.accent;
      await prefs.keyboard.press('ArrowRight');
      await prefs.keyboard.press('ArrowUp');
      await expect.poll(() => readTheme(cfgRoot)?.accent, { timeout: FILE_OP_TIMEOUT_MS }).not.toBe(before);

      // Escape closes it and the last applied value stands.
      await prefs.keyboard.press('Escape');
      await expect(prefs.getByTestId('control-colours.accent-picker')).toBeHidden();
    },
  );
});

/** Assert a locator's bounding box sits fully inside the window's viewport. */
async function expectWithinViewport(page: Page, box: { x: number; y: number; width: number; height: number } | null): Promise<void> {
  expect(box).not.toBeNull();
  const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 0.5);
}

test('the colour applies LIVE and persists — and rapid edits compound into one write (FR-022, FR-023)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      const hex = prefs.getByTestId('control-colours.accent-hex');

      // Several edits inside the 150 ms debounce window. They must COMPOUND into the last value,
      // not race each other — a picker that streams values during a drag is exactly where that
      // breaks, and it is the guarantee FR-023 names.
      for (const colour of ['#111111', '#222222', '#333333', '#abcdef']) {
        await hex.fill(colour);
        await hex.press('Enter');
      }

      await expect.poll(() => readTheme(cfgRoot)?.accent, { timeout: FILE_OP_TIMEOUT_MS }).toBe('#abcdef');

      // And it is live in the running application, not just on disk.
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--throng-colour-accent')
              .trim(),
          ),
        )
        .toBe('#abcdef');
    },
  );
});
