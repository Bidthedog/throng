import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  panelIds,
  addPanels,
  installResizeProbe,
  cleanupTemp,
  geom,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// 012 US1 (FR-001/002/005, SC-001a/006): the active panel is a single, visible,
// theme-driven focus context per window — the foreground treatment when the
// window is foreground, a dimmed inactive treatment when it is background (it
// persists, never disappears) — that re-homes deterministically when the active
// panel is closed, and that a pure focus change never resizes a terminal (SC-004).

/** The computed outline colour of a panel box (to prove the token actually swaps). */
function outlineColour(win: import('@playwright/test').Page, pid: string): Promise<string> {
  return win
    .getByTestId(`panel-${pid}`)
    .evaluate((el) => getComputedStyle(el).outlineColor);
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * The live `cmd` shell that made this file two apps is in the LAST test, so there is no test
 * after it for the shell to reach. It dies with the app in `afterAll`, and the root it is
 * sitting in is deleted AFTER that — which is also why the per-test cleanup had to go.
 *
 * Nothing is seeded before launch. Test 1 uses no root at all (C:/c/focus never exists) and
 * ends by dispatching a `focus` event, so it hands the window back the way it found it. Test 2
 * makes its own project, so `firstPanelId` and `panelIds` see only its workspace, and the
 * resize probe is installed and RESET inside test 2 — its count cannot include anything
 * earlier, and test 1 opens no terminal to resize.
 */
const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
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

test('exactly one active panel; it dims on window blur and restores on focus, without changing', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Focus', 'C:/c/focus');
    await addPanels(win, 2); // → three panels total
    await expect(win.locator('.panel-box')).toHaveCount(3);

    const [p1, p2] = await panelIds(win);
    await win.getByTestId(`panel-${p2}`).click();

    // Exactly one active panel, and it is p2.
    await expect(win.locator('.panel-box--active')).toHaveCount(1);
    await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
    const foregroundColour = await outlineColour(win, p2);

    // Send the window to the background → the indicator persists but switches to
    // its dimmed inactive treatment (SC-001a); it does NOT disappear or move.
    await win.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(win.getByTestId(`panel-${p2}`)).toHaveClass(/panel-box--active-dimmed/);
    await expect(win.locator('.panel-box--active')).toHaveCount(1);
    await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
    const backgroundColour = await outlineColour(win, p2);
    expect(backgroundColour).not.toBe(foregroundColour); // the token really swapped

    // Bring the window forward again → back to the foreground treatment, same panel.
    await win.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(win.getByTestId(`panel-${p2}`)).not.toHaveClass(/panel-box--active-dimmed/);
    await expect(win.getByTestId(`panel-${p2}`)).toHaveAttribute('data-active', 'true');
    expect(await outlineColour(win, p2)).toBe(foregroundColour);

    // Closing the active panel re-homes focus to the FR-005 deterministic target:
    // the panel PRECEDING it in layout order (p1), never leaving the window inputless.
    await win.getByTestId(`panel-close-${p2}`).click();
    await expect(win.locator('.panel-box')).toHaveCount(2);
    await expect(win.getByTestId(`panel-${p1}`)).toHaveAttribute('data-active', 'true');
    await expect(win.locator('.panel-box--active')).toHaveCount(1);
  });
});

test('changing which panel holds focus sends zero terminal resize messages (SC-004)', { tag: ['@extended', '@window', '@reserve:pty'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-focus-')));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'FocusTerm', root);
      const pid = await firstPanelId(win);

      // Type the first panel as a terminal and wait for it to be live.
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Add a second (plain) panel so there is somewhere to move focus TO. This
      // split DOES resize the terminal — so install + reset the probe AFTER it.
      await addPanels(win, 1);
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const [a, b] = await panelIds(win);
      // Let the split-induced resize settle before the probe starts counting — the pane layout
      // animates, so geom() waits for the panel to actually stop moving/resizing.
      await geom(win.getByTestId(`panel-${pid}`));

      const probe = await installResizeProbe(app);
      await probe.reset();

      // Move focus back and forth several times — a pure focus change, no pixel
      // size change → zero terminal resizes (FR-004/SC-004).
      for (let i = 0; i < 4; i += 1) {
        await win.getByTestId(`panel-${b}`).click();
        await win.getByTestId(`panel-${a}`).click();
      }
      // A pure focus change should trigger no resize at all — wait two animation frames rather
      // than a fixed duration, so any ResizeObserver callback the clicks might have triggered has
      // had its guaranteed chance to fire before the count below is read.
      await win.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
          ),
      );
      expect(await probe.count()).toBe(0);
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the application is still watching — the class dcdcb46 reverted three
    // conversions for.
  }
});
