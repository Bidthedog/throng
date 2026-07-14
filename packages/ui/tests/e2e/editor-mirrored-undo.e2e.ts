import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * SC-013 — constitution XI, proven to a USER (016, FR-026c/FR-028f · T127).
 *
 * Everything else in this feature asserts the document authority through its API. This is the only
 * test that shows a person the rule holds: one file, two windows, and an Undo pressed in the window
 * that did NOT make the edit.
 *
 * That is exactly what the shipped editor could not do. Its mirrored views were two CodeMirror
 * instances with two `history()` fields, reconciling by whole-document replace — so each view's
 * undo stack had never heard of the other's edits, and Ctrl+Z in the second window would revert
 * something else entirely, or nothing at all. The stack now belongs to the DOCUMENT.
 */

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Mirror', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'seed', originProjectId: 'x', title: 'P' } }] },
] }))()`;

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('Undo in a mirrored view reverts an edit made in the OTHER view (SC-013)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-mirundo-'));
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'UndoProj', root);
      const pid = await newEditor(win);

      const mainEditor = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // View A types the first word, and saves — so the document has a clean baseline to be dirty
      // against, and the dirty state we assert later is a real one.
      await mainEditor.click();
      await win.keyboard.type('ALPHA');
      await win.waitForTimeout(300);

      // Open the sub-workspace window and mirror the panel into it: ONE document, TWO views.
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      await win.getByTestId('menu-item-Mirror').click();
      await win.getByTestId('menu-item-T').click();

      const childEditor = child.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(child.getByTestId(`editor-${pid}`)).toBeVisible({ timeout: 10000 });
      await expect(childEditor).toContainText('ALPHA', { timeout: 10000 });
      await child.waitForTimeout(500); // let the child's initial load settle

      // ── View A makes an edit. View B sees it. ────────────────────────────────────────────────
      await win.bringToFront();
      await mainEditor.click();
      await win.keyboard.press('End');
      await win.keyboard.type('-BETA');

      await expect(mainEditor).toContainText('ALPHA-BETA');
      await expect(childEditor).toContainText('ALPHA-BETA', { timeout: 10000 });

      // Both views agree the document is unsaved. `dirty` is DERIVED by the authority and pushed to
      // every view — neither view decides it, and they cannot disagree about it.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 10000 });
      await expect(child.getByTestId(`panel-unsaved-${pid}`)).toBeVisible({ timeout: 10000 });

      // ── …and view B UNDOES it. ───────────────────────────────────────────────────────────────
      // The edit was made in the other window. A per-view history could not reach it.
      await child.bringToFront();
      await childEditor.click();
      await child.keyboard.press('Control+z');

      // It reverts in the view that pressed the key…
      await expect(childEditor).toHaveText('ALPHA', { timeout: 10000 });
      // …AND in the view that made the edit. One document, one state.
      await expect(mainEditor).toHaveText('ALPHA', { timeout: 10000 });

      // Redo, still from view B, reapplies it in both.
      await child.keyboard.press('Control+y');
      await expect(childEditor).toHaveText('ALPHA-BETA', { timeout: 10000 });
      await expect(mainEditor).toHaveText('ALPHA-BETA', { timeout: 10000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a mirrored view keeps its OWN cursor and scroll — view state is per view (FR-028c)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-mircur-'));
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'CursorProj', root);
      const pid = await newEditor(win);

      const mainEditor = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await mainEditor.click();
      await win.keyboard.type('one\ntwo\nthree');
      await win.waitForTimeout(300);

      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      await win.getByTestId('menu-item-Mirror').click();
      await win.getByTestId('menu-item-T').click();

      const childEditor = child.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(childEditor).toContainText('three', { timeout: 10000 });
      await child.waitForTimeout(500);

      // The line each window's caret is on, as the user actually SEES it — the active-line
      // highlight, not a reach into CodeMirror's internals.
      const activeLine = (page: Page) =>
        page.getByTestId(`editor-${pid}`).locator('.cm-activeLine');

      // Put the two carets on DIFFERENT lines: view B on the first, view A on the last.
      await child.bringToFront();
      await childEditor.click();
      await child.keyboard.press('Control+Home');
      await expect(activeLine(child)).toHaveText('one', { timeout: 10000 });

      await win.bringToFront();
      await mainEditor.click();
      await win.keyboard.press('Control+End');
      await expect(activeLine(win)).toHaveText('three', { timeout: 10000 });

      // An edit in view A is shared; view B's CURSOR is not. The buffer is one; the view is not.
      await win.keyboard.type('!');
      await expect(childEditor).toContainText('three!', { timeout: 10000 });
      await expect(activeLine(win)).toHaveText('three!');
      await expect(activeLine(child)).toHaveText('one'); // …view B's caret never moved
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
