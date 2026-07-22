/**
 * US2 (#140) — in the Files & Folders tree, double-clicking a directory row toggles its expansion
 * in place (expand if collapsed, collapse if expanded); single-click still selects only (#121);
 * the root never collapses (FR-004).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-dbl-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

test('double-clicking a directory toggles its expansion; single-click selects only (#140)', async () => {
  const root = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'DblClick', root);
      const tree = win.getByTestId('file-explorer-tree');
      const src = tree.getByText('src', { exact: true });
      await expect(src).toBeVisible();

      // Collapsed at first — its child is not rendered.
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // Single-click the folder name → selects only; it does NOT expand (#121 preserved).
      await src.click();
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // Double-click → expands (children reveal).
      await src.dblclick();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();

      // Double-click again → collapses (children hide).
      await src.dblclick();
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
