import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

// US10 (Delivery E): a project editor synced into a sub-workspace mirrors ONE
// document across both windows — content typed in the main window appears in the
// sub-workspace window (same panelId, cross-window content sync, FR-034).

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

test('a synced project editor mirrors one document across both windows', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-swed-'));
  try {
    await runApp(async (app, win) => {
      await win.evaluate(seedSub);
      await reloadWindow(win);
      await createProject(win, 'MirrorProj', root);
      const pid = await newEditor(win);

      // Type content into the main-window editor and let it flush to UI main.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('HELLO-MIRROR');
      await win.waitForTimeout(300);

      // Open the sub-workspace window.
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');

      // Sync the editor Panel into the sub-workspace's Tab "T".
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      await win.getByTestId('menu-item-Mirror').click();
      await win.getByTestId('menu-item-T').click();

      // The child window shows the SAME editor with the already-typed content.
      const childEditor = child.getByTestId(`editor-${pid}`);
      await expect(childEditor).toBeVisible({ timeout: 10000 });
      await expect(childEditor.locator('.cm-content')).toContainText('HELLO-MIRROR', {
        timeout: 10000,
      });
      // Let the child editor's initial load settle so it doesn't race the next edit.
      await child.waitForTimeout(500);

      // A live edit in the MAIN window mirrors into the sub-workspace window.
      await win.bringToFront();
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type(' MORE');
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('MORE');
      // … and it mirrors into the sub-workspace window (one document, FR-034).
      await expect(childEditor.locator('.cm-content')).toContainText('MORE', { timeout: 10000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

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
test('cut-line, a column paste and the language picker all work in a sub-workspace window', async () => {
  skipIfElevated();
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
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+c');

      // Open the sub-workspace window and sync the panel into it.
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await win.getByTestId('menu-item-Sync to').click();
      await win.getByTestId('menu-item-Mirror').click();
      await win.getByTestId('menu-item-T').click();

      const childEditor = child.getByTestId(`editor-${pid}`);
      await expect(childEditor).toBeVisible({ timeout: 10000 });
      await expect(childEditor.locator('.cm-content')).toContainText('aaaa', { timeout: 10000 });
      await child.waitForTimeout(500);

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
      await child.keyboard.press('Control+Home');
      await child.keyboard.press('ArrowDown'); // …line 2, column 0
      await child.keyboard.press('Control+v');
      await expect.poll(childDoc, { timeout: 8000 }).toBe('aaaa\naabbbb\nbbcccc\nccdddd\n');

      // …one Undo takes the whole ten-cell paste away again, in the child.
      await child.keyboard.press('Control+z');
      await expect.poll(childDoc, { timeout: 8000 }).toBe('aaaa\nbbbb\ncccc\ndddd\n');

      // CUT-LINE, driven in the child window.
      await child.keyboard.press('Control+Home');
      await child.keyboard.press('Control+x');
      await expect.poll(childDoc, { timeout: 8000 }).toBe('bbbb\ncccc\ndddd\n');

      // …and the LANGUAGE PICKER: it shows, and it applies, in the child.
      await child.getByTestId(`editor-language-${pid}`).click();
      await expect(child.getByTestId(`language-picker-${pid}`)).toBeVisible();
      await child.getByTestId(`language-filter-${pid}`).fill('shell');
      await child.getByTestId('language-option-shell').click();
      await expect(child.getByTestId(`editor-language-${pid}`)).toHaveText('Shell');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
