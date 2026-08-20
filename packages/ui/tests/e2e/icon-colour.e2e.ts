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
 * 018 / US5 — icons take their colour from the theme (FR-027 … FR-031).
 *
 * The bundled SVG set is monochrome line art: it reads well on dark themes and badly on light ones.
 * The obvious remedy — ship a black set and a white set — is the wrong one. The artwork already
 * inherits its colour, so the two sets would be the same art twice, and would STILL be wrong for
 * every theme that suits neither pure black nor pure white. One set, with a colour the theme can
 * override, is the answer.
 *
 * Unblocked only by feature 017: it is what made the artwork genuinely inherit its colour, so the
 * token finally has something to drive.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-ic-'));
  cfgRoots.push(dir);
  return dir;
}
/*
 * ONE app for this file, not one per test (034 FR-045, SC-010).
 *
 * All three tests seeded nothing. Only the third writes: it sets `colours.iconColour`, watches the
 * MAIN window adopt it, and then clears it again — so it already tidies up after itself, and the
 * restore is the belt to that braces.
 *
 * The ordering worth naming: the second test asserts the token is UNSET, both in the theme file and
 * as a live CSS variable in the main window. It runs before the third, and it polls rather than
 * reads — so even a broadcast still in flight from a restore converges rather than failing.
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

function readTheme(cfgRoot: string): Record<string, string> | undefined {
  const file = join(cfgRoot, 'themes', 'throng.json');
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as { colours?: Record<string, string> }).colours;
}

/** The colour actually painted on an icon in the MAIN window — where the user looks. */
function iconColourInApp(win: Page): Promise<string | null> {
  return win.evaluate(() => {
    const icon = document.querySelector('.icon');
    return icon ? getComputedStyle(icon).color : null;
  });
}

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:124` "the icon colour has exactly ONE control, beside the icon-pack selector (FR-027)" →
 * `packages/ui/tests/component/preferences-app.test.ts`, "the icon colour is edited in one place".
 *
 * The whole test was two DOM queries — a count and a containment — and it opened a preferences
 * window to make them. The count is the assertion rather than a detail of it: `colours.iconColour`
 * is a real colour token with a derived descriptor, so it is eligible for the generic Colours loop
 * AND hand-placed in the Icons section, and the obvious failure is that both render it. Two controls
 * for one value means editing one leaves the other silently disagreeing until the round trip lands.
 *
 * Both mutations redden: emptying `RENDERED_ELSEWHERE` (two controls) and moving the Icons row's
 * test id (one control, wrong place). The pair is what separates the count from the placement.
 *
 * ── WHAT STAYS ──
 *
 * Everything that reads a COMPUTED colour off a rendered `.icon` against a real cascade — which is
 * this file's subject and 034 FR-049's reserve.
 */
test('UNSET, icons inherit their host’s colour — so no bundled theme changes (FR-029)', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      // The control exists, beside the icon-pack selector, and it is EMPTY.
      const field = prefs.getByTestId('control-colours.iconColour-hex');
      await expect(field).toBeVisible();
      await expect(field).toHaveValue('');

      // Nothing is emitted, so `.icon { color: var(--throng-colour-iconColour, inherit) }` falls
      // through to `inherit`. That is the whole of FR-029: the token's ABSENCE is its meaning, and
      // its absence is the default, so the day it landed nothing looked any different.
      await expect
        .poll(() =>
          win.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--throng-colour-iconColour')
              .trim(),
          ),
        )
        .toBe('');

      // The theme file carries no icon colour either.
      expect(readTheme(cfgRoot)?.iconColour).toBeUndefined();
    },
  );
});

test('SET, every icon in every window adopts it (FR-030)', { tag: ['@extended', '@prefs', '@reserve:window'] }, async () => {
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);

      const before = await iconColourInApp(win);

      const field = prefs.getByTestId('control-colours.iconColour-hex');
      await field.fill('#ff00aa');
      await field.press('Enter');

      // It reaches the file…
      await expect.poll(() => readTheme(cfgRoot)?.iconColour, { timeout: FILE_OP_TIMEOUT_MS }).toBe('#ff00aa');

      // …and the MAIN window, which is a different renderer process. The hot-reload carries it, and
      // the artwork rides `currentColor`, so colouring the host is what colours the art.
      await expect.poll(() => iconColourInApp(win)).toBe('rgb(255, 0, 170)');
      expect(before).not.toBe('rgb(255, 0, 170)');

      // Clear it: emptiness means "inherit" again, and the icons go back to their host's colour.
      await field.fill('');
      await field.press('Enter');
      await expect.poll(() => iconColourInApp(win)).not.toBe('rgb(255, 0, 170)');
    },
  );
});
