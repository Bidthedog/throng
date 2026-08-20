import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};


/**
 * The throng application icon (#72). Two deliverables, one mark:
 *
 *  - the TITLE BAR mark — the simplified small-size artwork, inlined as SVG so it
 *    can be drawn in the theme's own colours (the artwork is a light frame around
 *    a body the colour of the app background; hardcoding #fff/#000 would make it
 *    vanish on the bundled Light theme);
 *  - the OS WINDOW icon — a multi-size .ico handed to every BrowserWindow, which
 *    is what the taskbar and Alt-Tab show.
 */

const icoPath = fileURLToPath(new URL('../../assets/throng.ico', import.meta.url));

test('the title bar carries the throng mark, left of the identity', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    const mark = win.getByTestId('throng-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveCount(1);

    // Sized to sit with the existing chrome glyphs (cog 15px, controls 10px), and
    // ahead of the identity text rather than floating elsewhere in the bar.
    const markBox = await mark.boundingBox();
    const textBox = await win.getByTestId('title-bar-identity').boundingBox();
    expect(markBox).not.toBeNull();
    expect(textBox).not.toBeNull();
    expect(markBox!.width).toBeGreaterThanOrEqual(14);
    expect(markBox!.width).toBeLessThanOrEqual(20);
    expect(markBox!.x).toBeLessThan(textBox!.x + 12);
  });
});

// The mark must re-colour with the active theme, not ship as fixed black-on-white:
// `Light` (a bundled theme) has a near-white background, where the artwork's white
// frame would disappear entirely. The frame + T take the identity text colour; the
// window body takes the app background, exactly as the artwork was drawn.
const cfgRoots: string[] = [];
function seedThemeColours(textMuted: string, appBg: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-icon-'));
  cfgRoots.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(
    join(dir, 'themes', 'throng.json'),
    JSON.stringify({ name: 'throng', colours: { textMuted, appBg } }, null, 2),
    'utf8',
  );
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0))
    cleanupTemp(dir);
});

test('the mark is drawn in the active theme’s colours, not hardcoded black and white', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  // Distinctive colours, unlike any bundled theme and unlike each other.
  const cfgRoot = seedThemeColours('#ff00aa', '#00cc55');
  const TEXT_MUTED = 'rgb(255, 0, 170)';
  const APP_BG = 'rgb(0, 204, 85)';
  await runOwnApp(
    async (_app, win) => {
      const mark = win.getByTestId('throng-mark');
      await expect(mark).toBeVisible();

      // The frame and the "T" are currentColor → the identity text colour.
      await expect
        .poll(() => mark.locator('.throng-mark__frame').evaluate((el) => getComputedStyle(el).fill))
        .toBe(TEXT_MUTED);
      await expect
        .poll(() => mark.locator('.throng-mark__glyph').evaluate((el) => getComputedStyle(el).fill))
        .toBe(TEXT_MUTED);

      // The window body is the app background — the artwork reads as a frame, and
      // never as a black hole punched in a light title bar.
      await expect
        .poll(() => mark.locator('.throng-mark__body').evaluate((el) => getComputedStyle(el).fill))
        .toBe(APP_BG);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});

test('every window that draws a title bar carries the mark', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  await runApp(async (app, win) => {
    await expect(win.getByTestId('throng-mark')).toBeVisible();

    // The preferences window draws the same bar (007, FR-007) and must be branded too.
    await win.getByTestId('title-bar-cog').click();
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      win.getByTestId('cog-menu-settings').click(),
    ]);
    await prefs.waitForLoadState('domcontentloaded');
    await expect(prefs.getByTestId('preferences-window')).toBeVisible();
    await expect(prefs.getByTestId('throng-mark')).toBeVisible();
  });
});

test('Electron can decode the bundled .ico the windows are given', { tag: ['@extended', '@window', '@reserve:native'] }, async () => {
  // The .ico is hand-packed (scripts/build-app-icons.mjs, no image dependency), so
  // the thing worth proving is that Chromium's decoder actually accepts it and finds
  // the sizes inside — a malformed container fails silently as a blank taskbar icon.
  await runApp(async (app) => {
    const icon = await app.evaluate(({ nativeImage }, path) => {
      const image = nativeImage.createFromPath(path);
      return { empty: image.isEmpty(), size: image.getSize() };
    }, icoPath);
    expect(icon.empty).toBe(false);
    expect(icon.size).toEqual({ width: 256, height: 256 });
  });
});
