/**
 * US6 (#157, spec 024 FR-018b): full keyboard navigation of context sub-menus. Arrow into a sub-menu
 * (→ / Enter) focuses its first child; arrow back out (← / Escape) closes it and returns focus to the
 * parent; only at the root does Escape close the whole menu.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
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


test('Shift+F10 and the ContextMenu key open the focused item’s menu (FR-018c)', { tag: ['@extended', '@window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menuopen-'));
  writeFileSync(join(root, 'thing.txt'), 'x\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MenuOpen', root);
      const tree = win.getByTestId('file-explorer-tree');
      /*
       * Wait for the two things a Shift+F10 at this row actually depends on (FR-053a, #244).
       *
       * A click selects the row and moves focus, but both land asynchronously — a keystroke sent in
       * the same beat can arrive while the body is still the active element, and Shift+F10 then
       * opens nothing. Measured as this test failing and flaking under load.
       *
       * What this guard used to poll was `(document.activeElement?.textContent ?? '')
       * .includes('thing.txt')`, and that could not fail. `textContent` is an element's text plus
       * every descendant's, so the predicate holds for any ancestor of the row — including the tree
       * container, which is where react-arborist's roving focus actually parks `activeElement`
       * (`tree-node.tsx`), and including `document.body` before focus has landed at all. It returned
       * true on its first sample whether the click landed, missed, or was deleted. #244 is that
       * guard; `notice-stacking.e2e.ts` writes the reasoning out at length, and it was copied here
       * as precedent precisely because it read like a real guard.
       *
       * So ask the two questions separately, each of which can be false:
       *   - is the ACTIVE ELEMENT inside the tree — `closest`, not text; and
       *   - has the selection reached THIS row, which is what `tree-row--selected` is.
       */
      const row = tree.getByText('thing.txt', { exact: true });
      const rowReady = async (): Promise<boolean> =>
        win.evaluate(
          () =>
            document.activeElement?.closest('[data-testid="file-explorer-tree"]') != null &&
            document
              .querySelector('.tree-row[data-rel-path="thing.txt"]')
              ?.classList.contains('tree-row--selected') === true,
        );

      await row.click();
      await expect.poll(rowReady, { timeout: 10_000 }).toBe(true);
      await win.keyboard.press('Shift+F10');
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('context-menu')).toHaveCount(0);

      // The dedicated ContextMenu (Menu) key does the same.
      await row.click();
      await expect.poll(rowReady, { timeout: 10_000 }).toBe(true);
      await win.keyboard.press('ContextMenu');
      await expect(win.getByTestId('context-menu')).toBeVisible();
    });
  } finally {
    cleanupTemp(root);
  }
});

test('closing a context menu by keyboard returns focus to the Files & Folders tree (#157 follow-up)', { tag: ['@extended', '@window'] }, async () => {
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

test('an advertised shortcut inside the menu runs the action and closes it — Ctrl+C then paste (#157 follow-up)', { tag: ['@extended', '@window'] }, async () => {
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

/*
 * MOVED to `packages/ui/tests/component/menu-keyboard.test.ts` (034 FR-045).
 *
 * "arrow keys open a sub-menu focusing its first child, and step back out to the parent (FR-018b)"
 * asserted roving focus INSIDE one component. It needed no window, no daemon and no project, and it
 * is now five component tests that run in about three seconds in total. What stays here is what a
 * DOM cannot show: a keypress arriving from the Files & Folders tree, focus returning to that tree,
 * and an in-menu shortcut whose effect is a file on disk.
 */
