import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow, cleanupTemp, geom, pressAction } from './harness.js';
import { openSubWorkspaceWindow } from './helpers/subworkspace-open.js';

// US10 (Delivery E): the mirrored-document claim (one document across both windows, FR-034) is proved by
// `editor-mirrored-undo.e2e.ts`; this file holds the sub-workspace parity test below.

const seedSub = `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
  { id: 'sw1', ownerUser: 'u', name: 'Mirror', colour: '#3fb950',
    bounds: { x: 0, y: 0, width: 500, height: 400 },
    tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'seed', originProjectId: 'x', title: 'P' } }] },
] }))()`;

/**
 * 016 FR-024 · T115 — the editor works IDENTICALLY in a sub-workspace window.
 *
 * FR-024's positive claim was untested. The scope table proves the seven commands do NOT fire in a
 * *background* window (T096), which is the negative half — and a background window is exactly what a
 * sub-workspace window is when it is not focused. If the scope check were a shade too eager, the
 * commands would be dead in the sub-workspace window too, and every existing test would still pass.
 *
 * So: cut-line, a column paste whose block was copied in the OTHER window (the mode is app-global,
 * FR-015c), and the language picker — all driven in the child.
 */
test('cut-line, a column paste and the language picker all work in a sub-workspace window', { tag: ['@extended', '@editor', '@reserve:window'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-swpar-'));
  try {
    writeFileSync(join(root, 'grid.txt'), 'aaaa\nbbbb\ncccc\ndddd\n');
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'ParityProj', root);

      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('grid.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('aaaa', {
        timeout: 8000,
      });

      // Copy a two-column, three-row BLOCK in the MAIN window.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+Home');
      await pressAction(win, 'editor.columnSelectDown');
      await pressAction(win, 'editor.columnSelectDown');
      await pressAction(win, 'editor.columnSelectRight');
      await pressAction(win, 'editor.columnSelectRight');
      await win.keyboard.press('ControlOrMeta+c');

      // Open the sub-workspace window and sync the panel into it.
      const child = await openSubWorkspaceWindow(app, win, 'sw1');
      await child.waitForLoadState('domcontentloaded');
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      await win.getByTestId('menu-item-Mirror').click();
      await win.getByTestId('menu-item-T').click();

      const childEditor = child.getByTestId(`editor-${pid}`);
      await expect(childEditor).toBeVisible({ timeout: 10000 });
      await expect(childEditor.locator('.cm-content')).toContainText('aaaa', { timeout: 10000 });
      // Let the child editor's initial load settle so it doesn't race the next edit.
      await geom(childEditor);

      const childDoc = (): Promise<string> =>
        child.evaluate(
          (id) =>
            [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
              .map((l) => (l.textContent === '​' ? '' : l.textContent))
              .join('\n'),
          pid,
        );

      // The COLUMN PASTE first — of the block copied in the OTHER window. The clipboard's mode is
      // app-global, so it must survive the crossing (FR-015c). It goes first deliberately: a
      // cut-line here would overwrite the clipboard with its own full-line entry, and the paste
      // would then be testing nothing but the cut that preceded it.
      await child.bringToFront();
      await childEditor.locator('.cm-content').click();
      await child.keyboard.press('ControlOrMeta+Home');
      await child.keyboard.press('ArrowDown'); // …line 2, column 0
      await child.keyboard.press('ControlOrMeta+v');
      await expect.poll(childDoc, { timeout: 8000 }).toBe('aaaa\naabbbb\nbbcccc\nccdddd\n');

      // …one Undo takes the whole ten-cell paste away again, in the child.
      await child.keyboard.press('ControlOrMeta+z');
      await expect.poll(childDoc, { timeout: 8000 }).toBe('aaaa\nbbbb\ncccc\ndddd\n');

      // CUT-LINE, driven in the child window.
      await child.keyboard.press('ControlOrMeta+Home');
      await pressAction(child, 'editor.cutLine');
      await expect.poll(childDoc, { timeout: 8000 }).toBe('bbbb\ncccc\ndddd\n');

      // …and the LANGUAGE PICKER: it shows, and it applies, in the child.
      await child.getByTestId(`editor-language-${pid}`).click();
      await expect(child.getByTestId(`language-picker-${pid}`)).toBeVisible();
      await child.getByTestId(`language-filter-${pid}`).fill('shell');
      await child.getByTestId('language-option-shell').click();
      await expect(child.getByTestId(`editor-language-${pid}`)).toHaveText('Shell');
    });
  } finally {
    cleanupTemp(root);
  }
});
