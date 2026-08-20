import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

// US1 / Plan Phase A (FR-001..008, SC-001/002/010): a new Panel shows an
// extensible type-selection form instead of "Empty Panel"; choosing Terminal
// swaps in its inputs; Clear resets; Confirm assigns the type. In Phase C, Confirm
// also launches the live terminal, and closing it reverts the Panel to the form.
// (Reload persistence is covered by terminal-persistence.e2e.ts / US3.)

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * ══ THIS FILE STARTS TWO REAL SHELLS, AND THAT IS EXACTLY WHY IT IS SAFE ══
 *
 * The blanket rule is that a spec leaving a live shell keeps its own app, because the shell
 * outlives the test that made it and holds the project root. Here the shell's DEATH is the
 * subject: each test types `exit` and then asserts the panel has REVERTED TO ITS TYPE FORM
 * (:62, :102). That assertion is the application observing the session end — a named teardown,
 * awaited, not a hope. Neither test can pass with its shell still running.
 *
 * The roots still move to `afterAll`: cmd can hold a handle for a moment after the panel has
 * reverted, and deleting a watched root under the running app is the class dcdcb46 reverted.
 *
 * Test 2 also opens a SUB-WORKSPACE WINDOW and never closes it. The afterEach closes it: a
 * second top-level window competes for focus, and throng closes menus on blur.
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

test.afterEach(async () => {
  if (!shared) return;
  for (const page of shared.app.windows()) {
    if (!page.isClosed() && page.url().includes('sw=')) await page.close().catch(() => {});
  }
  await expect
    .poll(() => shared.app.windows().filter((w) => w.url().includes('sw=')).length, {
      timeout: 5000,
    })
    .toBe(0);
  await shared.win.bringToFront();
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

test('replaces Empty Panel with the type form; swaps inputs; Clear resets; Confirm types + launches', { tag: ['@extended', '@window', '@reserve:pty'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-form-')));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Typed', root);
      const pid = await firstPanelId(win);

      // The body is the type-selection form, not the old "Empty Panel" placeholder.
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible();
      await expect(win.getByTestId(`panel-body-${pid}`)).not.toContainText('Empty Panel');

      // No type selected yet → Confirm is blocked (FR-005).
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeDisabled();

      // Selecting Terminal reveals its inputs (FR-003).
      const select = win.getByTestId(`panel-type-select-${pid}`);
      await select.selectOption('terminal');
      await expect(win.getByTestId('terminal-flavour')).toBeVisible();
      await expect(win.getByTestId('terminal-shell-arguments')).toBeVisible();
      await expect(confirm).toBeEnabled();

      // Clear returns to the initial empty state (FR-004).
      await win.getByTestId(`panel-type-clear-${pid}`).click();
      await expect(win.getByTestId('terminal-flavour')).toHaveCount(0);
      await expect(confirm).toBeDisabled();

      // Re-select (cmd flavour) and Confirm → the form + type control go away and a
      // live terminal opens (FR-006/014).
      await select.selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      // The Panel header marks its type with an icon; the type AND flavour are in
      // its hover title (012 — the former text pill was replaced by the icon).
      const kind = win.getByTestId(`panel-kind-${pid}`);
      await expect(kind).toHaveAttribute('title', /Terminal/);
      await expect(kind).toHaveAttribute('title', /Command Prompt/);
      // Wait for cmd's prompt (its cwd) so it is ready for input.
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Close the shell → the Panel reverts to the form (FR-020) and the root unlocks.
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the application is still watching — the class dcdcb46 reverted three
    // conversions for.
  }
});

test('the type form renders and confirms in a sub-workspace window (FR-008)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-form-sub-')));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'SubForm', root);
      const pid = await firstPanelId(win);

      // Sync (clone) the untyped Panel into a new sub-workspace window.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await win.getByTestId('menu-item-Sync to').click();
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('menu-item-New Sub-workspace').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await expect(child.getByTestId('subworkspace-window')).toBeVisible();

      // The same type-selection form renders in the child window and confirms there.
      await expect(child.getByTestId(`panel-type-form-${pid}`)).toBeVisible();
      await child.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await child.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = child.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const term = child.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Close the shell so the root unlocks before teardown.
      await term.click();
      await child.keyboard.type('exit');
      await child.keyboard.press('Enter');
      await expect(child.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the application is still watching — the class dcdcb46 reverted three
    // conversions for.
  }
});
