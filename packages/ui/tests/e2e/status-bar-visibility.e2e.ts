/**
 * US1 (#152, spec 024): the editor and terminal status bars are preference-controlled and visible by
 * default. Hiding a bar removes only that surface — the word-wrap command keeps working with the
 * editor bar hidden (FR-001b/c). The new terminal status bar shows the shell flavour label (FR-001).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test (034 FR-045, SC-027) — 2 launches -> 1.
 *
 * Nothing is seeded before launch, and the two things each test leaves behind are both
 * downstream of everything that reads them:
 *
 *  - Test 1 starts a real `cmd` and never kills it. Test 2 makes its OWN project, so that
 *    terminal's panel is not even rendered while test 2 runs — an inactive project's workspace
 *    is not mounted — and every locator test 2 uses is keyed to a panel id it made itself. The
 *    shell dies with the app in `afterAll`, and the root it is sitting in is deleted AFTER that
 *    rather than out from under it, which is the one thing that had to change.
 *  - Test 2 turns `editor.showStatusBar` off in the shared config root and leaves the
 *    preferences window open. It is the last test; nothing reads either.
 *
 * ORDER: test 1 must stay first. Its claim is that the terminal status bar is present BY
 * DEFAULT, which is a claim about settings nothing has yet written to.
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

test('the terminal status bar shows the flavour label by default (#152)', { tag: ['@extended', '@window'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-tsb-')));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TsbProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();

      // The new status bar is present by default and names the flavour.
      const bar = win.getByTestId(`terminal-status-bar-${pid}`);
      await expect(bar).toBeVisible();
      await expect(bar).not.toBeEmpty();
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});

test('hiding the editor status bar keeps the word-wrap command working (#152)', { tag: ['@extended', '@window'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-esb-')));
  writeFileSync(join(root, 'x.txt'), 'y'.repeat(300) + '\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'EsbProj', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('x.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('yyy', {
        timeout: 8000,
      });

      // Editor status strip visible by default.
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toBeVisible();

      // Hide it via settings.
      await win.getByTestId('title-bar-cog').click();
      const [prefs] = await Promise.all([
        win.context().waitForEvent('page'),
        win.getByTestId('cog-menu-settings').click(),
      ]);
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      await prefs.getByTestId('control-editor.showStatusBar').click();

      // The strip is gone, but Ctrl+Alt+W still toggles wrap (the command is not stranded).
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toHaveCount(0);
      await win.getByTestId(`editor-${pid}`).click();
      const whiteSpace = () =>
        win
          .getByTestId(`editor-${pid}`)
          .locator('.cm-content')
          .evaluate((el) => getComputedStyle(el as HTMLElement).whiteSpace);
      const before = await whiteSpace();
      await win.keyboard.press('Control+Alt+w');
      await expect.poll(whiteSpace).not.toBe(before); // wrap flipped → the command still runs

      // …and "Set Language…" temporarily REVEALS the hidden strip with its picker open, rather than
      // doing nothing at all (#152 follow-up). The strip owns the picker, so an unmounted strip used
      // to make an enabled menu item inert.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click({ button: 'right' });
      await win.getByTestId('menu-item-Set Language…').click();
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toBeVisible({ timeout: 5000 });
      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible();

      // Choosing a language applies it and puts the temporarily-revealed strip away again.
      await win.getByTestId('language-option-json').click();
      await expect(win.getByTestId(`language-picker-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`editor-status-strip-${pid}`)).toHaveCount(0);
    });
  } finally {
    // The root is deleted in `afterAll`, once the shared app has CLOSED. Deleting it here would
    // remove a folder the explorer is still watching.
  }
});
