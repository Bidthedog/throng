import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * US2 — the editor CONTENT context menu (016, FR-012/FR-012a/FR-012b · T060).
 *
 * Mouse-only editing: a user who never touches Ctrl+X must be able to cut, copy and paste. And the
 * menu must be the CONTENT's, not the panel's — right-clicking text offers Cut, not Save.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-cmenu-'));
  writeFileSync(join(root, 'lines.txt'), 'alpha\nbeta\ngamma\n');
  return root;
}

async function openEditorWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('alpha', {
    timeout: 8000,
  });
  return pid;
}

const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

/** The line element, by its text — a stable place to aim a right-click. */
const line = (win: Page, pid: string, text: string) =>
  win.getByTestId(`editor-${pid}`).locator('.cm-line').filter({ hasText: text }).first();

test('mouse-only cut and paste — no selection cuts the whole line (FR-012b)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      // Right-click IN a line, with nothing selected, and Cut. The item is never disabled for want
      // of a selection: the line is the unit, which is what the user plainly meant.
      await line(win, pid, 'beta').click({ button: 'right' });
      await win.getByTestId('menu-item-Cut').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\ngamma\n');

      // …and paste it back, from the menu, with the caret inside another line. A full-line entry
      // goes in as a whole line ABOVE, leaving the line it landed on unsplit (FR-015a).
      await line(win, pid, 'gamma').click({ button: 'right' });
      await win.getByTestId('menu-item-Paste').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('right-clicking INSIDE a selection preserves it; outside collapses it (FR-012a)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Select the whole first line.
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+End');

      // Right-click INSIDE that selection and Copy. The selection must survive the right-click —
      // collapsing it would destroy the very thing the user right-clicked to act on.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Copy').click();

      // Paste at the end: a VERBATIM copy of the selection (no trailing newline), so it appends to
      // the line rather than inserting a new one — proving the selection was preserved, not
      // collapsed to a caret (which would have copied the whole LINE and pasted it above).
      await content.click();
      await win.keyboard.press('Control+End');
      await win.keyboard.press('Control+v');
      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\nalpha');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('right-clicking OUTSIDE a selection moves the caret there (FR-012a)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      // Select line 1…
      await content.click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+End');

      // …then right-click on line 3, which is OUTSIDE it. The selection collapses and the caret
      // moves to the click, so Cut takes THAT line — not the one that was selected.
      await line(win, pid, 'gamma').click({ button: 'right' });
      await win.getByTestId('menu-item-Cut').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Undo from the content menu reaches the document authority (FR-026b)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      await line(win, pid, 'beta').click({ button: 'right' });
      await win.getByTestId('menu-item-Cut').click();
      await expect.poll(() => docText(win, pid)).toBe('alpha\ngamma\n');

      // The menu's Undo must go to the AUTHORITY. CodeMirror's own `undo` operates on the local
      // `history()` that this feature deleted — a menu item bound to it would be a dead no-op that
      // looks perfectly correct in the source.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Undo').click();

      await expect.poll(() => docText(win, pid)).toBe('alpha\nbeta\ngamma\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the CONTENT menu is distinct from the panel-HEADER menu (FR-014)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      // The content menu acts on the TEXT.
      await line(win, pid, 'alpha').click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Cut')).toBeVisible();
      await expect(win.getByTestId('menu-item-Set Language…')).toBeVisible();
      await expect(win.getByTestId('menu-item-Save')).toHaveCount(0); // …not on the panel
      await win.keyboard.press('Escape');

      // The panel-header menu acts on the PANEL, and is unchanged by this feature.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('menu-item-Save')).toBeVisible();
      await expect(win.getByTestId('menu-item-Cut')).toHaveCount(0); // …not on the text
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('“Set Language…” opens the SAME picker the status strip does (FR-010/FR-012)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Menu', root);
      const pid = await openEditorWithFile(win);

      await line(win, pid, 'alpha').click({ button: 'right' });
      await win.getByTestId('menu-item-Set Language…').click();

      await expect(win.getByTestId(`language-picker-${pid}`)).toBeVisible({ timeout: 5000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
