/**
 * US6 (#157, spec 024 FR-018b): full keyboard navigation of context sub-menus. Arrow into a sub-menu
 * (→ / Enter) focuses its first child; arrow back out (← / Escape) closes it and returns focus to the
 * parent; only at the root does Escape close the whole menu.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
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

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);


/** Arrow-Down through the menu until the focused item has the given testid (bounded). */
async function focusItemByArrows(win: Page, testId: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const focused = await win.locator(':focus').getAttribute('data-testid').catch(() => null);
    if (focused === testId) return;
    await win.keyboard.press('ArrowDown');
  }
  throw new Error(`could not focus ${testId} by arrows`);
}

test('Shift+F10 and the ContextMenu key open the focused item’s menu (FR-018c)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menuopen-'));
  writeFileSync(join(root, 'thing.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuOpen', root);
      const tree = win.getByTestId('file-explorer-tree');
      /*
       * Wait for the row to actually HOLD focus before pressing a key at it.
       *
       * A click selects the row and moves focus, but the focus call lands asynchronously — so a
       * keystroke sent in the same beat can arrive while the document body is still the active
       * element, and Shift+F10 then opens nothing. Measured as this test failing and flaking under
       * load. Polling `document.activeElement` waits for the state the key press depends on.
       */
      const row = tree.getByText('thing.txt', { exact: true });
      const rowFocused = async (): Promise<boolean> =>
        win.evaluate(() => (document.activeElement?.textContent ?? '').includes('thing.txt'));

      await row.click();
      await expect.poll(rowFocused, { timeout: 10_000 }).toBe(true);
      await win.keyboard.press('Shift+F10');
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);

      // The dedicated ContextMenu (Menu) key does the same.
      await row.click();
      await expect.poll(rowFocused, { timeout: 10_000 }).toBe(true);
      await win.keyboard.press('ContextMenu');
      await expect(win.getByTestId('context-menu')).toBeVisible();
    });
  } finally {
    cleanupTemp(root);
  }
});

test('closing a context menu by keyboard returns focus to the Files & Folders tree (#157 follow-up)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menufocus-'));
  writeFileSync(join(root, 'thing.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuFocus', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('thing.txt', { exact: true }).click();
      // Open by keyboard, then close by keyboard — focus must land back inside the tree.
      await win.keyboard.press('Shift+F10');
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);
      await expect
        .poll(() =>
          win.evaluate(
            () => document.activeElement?.closest('[data-testid="file-explorer-tree"]') != null,
          ),
        )
        .toBe(true);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('an advertised shortcut inside the menu runs the action and closes it — Ctrl+C then paste (#157 follow-up)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menushort-'));
  writeFileSync(join(root, 'thing.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuShort', root);
      const tree = win.getByTestId('file-explorer-tree');
      // Open the file's menu, then Ctrl+C — the menu closes and the file is on the clipboard.
      await tree.getByText('thing.txt', { exact: true }).click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Copy')).toBeVisible();
      await win.keyboard.press('Control+c');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);
      // Paste at the root → a de-duplicated copy proves Ctrl+C actually copied.
      await tree.locator('.tree-row--root').click({ button: 'right' });
      await win.getByTestId('menu-item-Paste').click();
      await expect(tree.getByText('thing copy.txt', { exact: true })).toBeVisible({ timeout: 6000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('arrow keys open a sub-menu focusing its first child, and step back out to the parent (FR-018b)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menukbd-'));
  writeFileSync(join(root, 'note.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuKbd', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('note.txt', { exact: true }).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();

      // Navigate to the "Copy Path" parent (a sub-menu-bearing item, from 023).
      await focusItemByArrows(win, 'menu-item-Copy Path');

      // ArrowRight opens the sub-menu AND moves focus to its first child.
      await win.keyboard.press('ArrowRight');
      await expect(win.getByTestId('submenu-Copy Path')).toBeVisible();
      const firstChildFocused = await win
        .locator('[data-testid="submenu-Copy Path"] .context-menu__item:focus')
        .count();
      expect(firstChildFocused).toBe(1);

      // ArrowLeft closes the sub-menu and returns focus to the parent.
      await win.keyboard.press('ArrowLeft');
      await expect(win.getByTestId('submenu-Copy Path')).toHaveCount(0);
      await expect(win.locator(':focus')).toHaveAttribute('data-testid', 'menu-item-Copy Path');

      // Re-open with Enter (also focuses the first child), then Escape steps back out (not closing all).
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('submenu-Copy Path')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('submenu-Copy Path')).toHaveCount(0);
      await expect(win.getByTestId('context-menu')).toBeVisible(); // root menu still open
      await expect(win.locator(':focus')).toHaveAttribute('data-testid', 'menu-item-Copy Path');

      // Escape at the root closes the whole menu.
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
