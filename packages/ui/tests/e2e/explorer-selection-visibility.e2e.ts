/**
 * The Files & Folders selection highlight belongs to the ACTIVE pane (024 follow-up).
 *
 * The tree always HAS a selection — it is what every file operation acts on, and it tracks the open
 * editor — but drawing it from an inactive pane made the application look as though two things were
 * current at once: a highlighted row here, a highlighted panel there, and nothing to say which the
 * next keystroke would reach. The highlight now goes when the pane does, and comes back with it.
 * The selection underneath is never touched.
 *
 * #188 refined the boundary rather than moving it. "Which row the next keystroke acts on" is still
 * the active pane's business alone — asserted below with a FOLDER, so the row under test is a pure
 * selection and nothing else. "Which file you are editing" is a different statement, and it is now
 * marked wherever the keyboard is, because the whole point of the tree following the editor is lost
 * if the result is invisible while you type. That mark is asserted in
 * explorer-follow-active-editor.e2e.ts, and the last case here pins the two rules together.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. Two temp roots, two project names (`SelVisProj`,
 * `SelVisOpen`).
 *
 * The roots are deleted in `afterAll`, NOT per test: under one app a per-test cleanup removes a
 * folder the application is still watching.
 *
 * Test 2 reads `win.locator('.cm-content').first()` WINDOW-WIDE. That is safe here for a reason
 * worth stating rather than assuming: test 1 never makes an editor at all, and an inactive
 * project's workspace is not rendered, so there is no second `.cm-content` for `.first()` to find.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed option does not fail,
 * it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one daemon, so a failure SKIPS the rest rather than
 * running them against what it left behind.
 */
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

/** The computed background of the selected row — the highlight itself, not the class that names it. */
function selectedRowBackground(win: Page): Promise<string> {
  return win.evaluate(() => {
    const row = document.querySelector(
      '[data-testid="file-explorer-tree"] .tree-row--selected',
    ) as HTMLElement | null;
    return row ? getComputedStyle(row).backgroundColor : 'no-selected-row';
  });
}

test('the tree highlights its selection only while its pane is active', { tag: ['@extended', '@explorer'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-selvis-')));
  writeFileSync(join(root, 'picked.txt'), 'x\n');
  // A FOLDER is the subject: a single click selects it and nothing else (#121/#140), so the row
  // carries the selection and no other meaning — which is what this rule is about.
  mkdirSync(join(root, 'stuff'));
  await runApp(async (_app, win) => {
    await createProject(win, 'SelVisProj', root);
    const pid = await firstPanelId(win);
    const tree = win.getByTestId('file-explorer-tree');
    const row = tree.getByText('stuff', { exact: true });
    await expect(row).toBeVisible({ timeout: 8000 });

    // Selecting in the tree makes the pane active, and the row is highlighted.
    await row.click();
    await expect(tree.locator('.tree-row--selected')).toContainText('stuff');
    const lit = await selectedRowBackground(win);
    expect(lit).not.toBe(TRANSPARENT);
    expect(lit).not.toBe('no-selected-row');

    // Working somewhere else takes the highlight away — but NOT the selection: the row keeps its
    // class, so every file operation still knows what it acts on.
    await win.getByTestId(`panel-${pid}`).click();
    await expect.poll(() => selectedRowBackground(win)).toBe(TRANSPARENT);
    await expect(tree.locator('.tree-row--selected')).toContainText('stuff');

    // Coming back lights it again — the same row, without having to re-pick it.
    await row.click();
    await expect.poll(() => selectedRowBackground(win)).toBe(lit);
  });
});

test('an open file keeps its own mark from an inactive pane (#188)', { tag: ['@extended', '@explorer'] }, async () => {
  // The two rules meeting: the selection highlight is the active pane's, but the file the editor is
  // showing says so from anywhere. Here the SAME row is both, and only the second survives the pane
  // going inactive.
  const root = own(mkdtempSync(join(tmpdir(), 'throng-selvis-open-')));
  writeFileSync(join(root, 'picked.txt'), 'x\n');
  await runApp(async (_app, win) => {
    await createProject(win, 'SelVisOpen', root);
    const tree = win.getByTestId('file-explorer-tree');
    const rowFor = (rel: string) => tree.locator(`.tree-row[data-rel-path="${rel}"]`);

    // Opening it from the tree both selects the row and puts the file in an editor.
    await tree.getByText('picked.txt', { exact: true }).click();
    await expect(win.locator('.cm-content').first()).toContainText('x', { timeout: 8000 });
    await expect(rowFor('picked.txt')).toHaveClass(/tree-row--active-file/);

    // Into the editor: the pane goes inactive, so the SELECTION highlight goes — and the row is
    // still visibly the file being edited.
    await win.locator('.cm-content').first().click();
    await expect(win.getByTestId('files-pane')).toHaveAttribute('data-active-pane', 'false');
    await expect(rowFor('picked.txt')).toHaveClass(/tree-row--active-file/);
    expect(await rowFor('picked.txt').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      TRANSPARENT,
    );
  });
});
