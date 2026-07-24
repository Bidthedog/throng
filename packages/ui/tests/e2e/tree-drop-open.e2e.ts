/**
 * US4 (#114, spec 024): dragging a file from Files & Folders onto an untyped panel opens it as an
 * editor; a folder or multi-select is rejected (the panel stays untyped). Driven through the
 * throng:tree-drop seam (a real react-dnd → native drop is not scriptable).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

function treeDrop(win: Page, panelId: string, paths: string[], singleFile: boolean): Promise<void> {
  return win.evaluate(
    ([id, list, single]) => {
      window.dispatchEvent(
        new CustomEvent('throng:tree-drop', {
          detail: { panelId: id, paths: list, singleFile: single },
        }),
      );
    },
    [panelId, paths, singleFile] as const,
  );
}

test('a single tree file dropped on an untyped panel opens it as an editor (#114)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-treeopen-'));
  writeFileSync(join(root, 'hello.txt'), 'HELLO-FROM-TREE\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TreeOpenProj', root);
      const pid = await firstPanelId(win);
      // The first panel is untyped (type-selection form).
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();

      // A single file → becomes an editor showing the file.
      await treeDrop(win, pid, [join(root, 'hello.txt')], true);
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible({ timeout: 8000 });
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'HELLO-FROM-TREE',
        { timeout: 8000 },
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('dropping an already-open file focuses the existing editor, not a second view (#114)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-treeopen2-'));
  writeFileSync(join(root, 'shared.txt'), 'SHARED-DOC\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SharedProj', root);
      const p1 = await firstPanelId(win);
      // Panel 1 opens the file as an editor.
      await win.getByTestId(`panel-type-select-${p1}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${p1}`).click();
      await win.getByTestId(`editor-${p1}`).click();
      await win.getByTestId('file-explorer-tree').getByText('shared.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${p1}`).locator('.cm-content')).toContainText('SHARED-DOC', {
        timeout: 8000,
      });

      // A second, untyped panel.
      await win.getByTestId(`panel-add-${p1}`).click();
      const ids = await win.locator('[data-testid^="panel-type-select-"]').evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace('panel-type-select-', '')),
      );
      const p2 = ids[0];
      expect(p2).toBeTruthy();

      // Dropping the already-open file on the untyped panel → it stays untyped (no second view).
      await treeDrop(win, p2, [join(root, 'shared.txt')], true);
      await win.waitForTimeout(400);
      await expect(win.getByTestId(`panel-type-select-${p2}`)).toBeVisible();
      await expect(win.getByTestId(`editor-${p2}`)).toHaveCount(0);
      // Exactly one editor still shows the doc.
      expect(await win.locator('.cm-content', { hasText: 'SHARED-DOC' }).count()).toBe(1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a folder or multi-select dropped on an untyped panel is rejected (#114)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-treereject-'));
  writeFileSync(join(root, 'a.txt'), 'A\n');
  writeFileSync(join(root, 'b.txt'), 'B\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'RejectProj', root);
      const pid = await firstPanelId(win);
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();

      // Multi-select (singleFile false) → rejected, panel stays untyped.
      await treeDrop(win, pid, [join(root, 'a.txt'), join(root, 'b.txt')], false);
      await win.waitForTimeout(400);
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toBeVisible();
      await expect(win.getByTestId(`editor-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
