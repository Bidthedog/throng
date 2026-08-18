import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openApp,
  createProject,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/**
 * US10 / FR-035 — the STRANDED HOVER never lingers when the window is blurred.
 *
 * The reported path: the cog menu's "Themes" item sits over the Files & Folders root; clicking it
 * opens Preferences (which blurs the main window) and closes the menu with NO pointer movement, so the
 * root is left painted with its `:hover` background. The general case: any element left under the
 * pointer while the window loses focus must not keep a hover background until a real pointermove with
 * the window focused restores it.
 */

const BG = (el: Element): string => getComputedStyle(el).backgroundColor;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** A project folder on disk so the file tree renders real rows. */
function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-hover-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), '# demo\n');
  return root;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. What separated these two tests is the state test 1 exists to
 * PRODUCE: it opens the singleton preferences window and leaves the main window flagged
 * `data-window-blurred`, which is precisely the flag that suppresses a hover background. Test
 * 2's opening claim is that a control hovered in a FOCUSED window paints — so test 1's leftover
 * would make it fail, and a conversion without the afterEach below would be a broken one.
 *
 * The afterEach clears exactly that, by the route test 2 itself documents as the only one that
 * works: the flag is not cleared by focus alone, but by a genuine pointermove in a focused
 * window. The preferences window is closed first — it is a singleton, so a second
 * `waitForEvent('window')` against one left standing would never fire.
 */
test.describe.configure({ mode: 'serial' });

const ownedRoots: string[] = [];
/** Register a temp directory for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

test.afterEach(async () => {
  if (!shared) return;
  for (const page of shared.app.windows()) {
    if (!page.isClosed() && page.url().includes('prefs=')) await page.close().catch(() => {});
  }
  await shared.win.bringToFront();
  // Focus ALONE does not clear the flag — that is this file's own finding. A real pointermove
  // in a focused window is what does, so the restore uses the same route the assertion does.
  await shared.win.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  });
  await expect
    .poll(() => shared.win.evaluate(() => document.body.hasAttribute('data-window-blurred')), {
      timeout: 5000,
    })
    .toBe(false);
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

test('the Files & Folders root drops its hover background while Preferences is open (FR-035)', { tag: ['@extended', '@window'] }, async () => {
  const projectRoot = own(makeProjectFolder());
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Hoverer', projectRoot);
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();
      const root = win.locator('.tree-row--root');
      await expect(root).toBeVisible();

      // Hover it: the row paints its hover background while the window is focused.
      await root.hover();
      const hoveredBg = await root.evaluate(BG);
      expect(hoveredBg).not.toBe(TRANSPARENT);

      // Open Preferences WITHOUT moving the pointer (via the bridge, as the cog click ultimately does)
      // — the root stays geometrically `:hover`, but the main window blurs. This is the exact bug.
      const [prefs] = await Promise.all([
        app.waitForEvent('window'),
        win.evaluate(() => window.throng?.openPreferences?.('themes')),
      ]);
      await prefs.waitForLoadState('domcontentloaded');

      // The main window is now flagged blurred, and the stranded hover no longer paints.
      await expect
        .poll(() => win.evaluate(() => document.body.hasAttribute('data-window-blurred')))
        .toBe(true);
      await expect.poll(() => root.evaluate(BG)).not.toBe(hoveredBg);
      expect(await root.evaluate(BG)).toBe(TRANSPARENT);
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

test('a stranded element keeps no hover background until a real pointermove refocuses it (FR-035)', { tag: ['@extended', '@window'] }, async () => {
  await runApp(async (_app, win) => {
    // Any element with a gated hover background left under the pointer. The main window control is
    // always present and its hover paints `hoverSurface`.
    const control = win.getByTestId('window-min');
    await expect(control).toBeVisible();

    await control.hover();
    const hoveredBg = await control.evaluate(BG);
    expect(hoveredBg).not.toBe(TRANSPARENT); // hovered while focused

    // The window loses focus with the pointer still stranded over the control (no pointer movement).
    await win.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => control.evaluate(BG)).toBe(TRANSPARENT); // hover suppressed

    // Focus ALONE must not restore it — the pointer has not genuinely moved onto anything yet.
    await win.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(await control.evaluate(BG)).toBe(TRANSPARENT);

    // A genuine pointer movement in the focused window clears the flag; hover paints again.
    await win.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
    await expect
      .poll(() => win.evaluate(() => document.body.hasAttribute('data-window-blurred')))
      .toBe(false);
    await control.hover();
    await expect.poll(() => control.evaluate(BG)).not.toBe(TRANSPARENT);
  });
});
