/**
 * US7 (#141) — the "default file-open target" preference. With "New Editor", each opened file lands
 * in a new editor panel; with "Last Active Editor" (default), opens reuse the last active editor.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-us7-'));
  writeFileSync(join(root, 'a.txt'), 'AAA\n');
  writeFileSync(join(root, 'b.txt'), 'BBB\n');
  return root;
}

const editors = (win: import('@playwright/test').Page) =>
  win.locator('[data-testid^="editor-"]').filter({ has: win.locator('.cm-content') });

test('with "New Editor", each opened file lands in a new editor panel (#141)', async () => {
  const root = makeProject();
  const cfg = mkdtempSync(join(tmpdir(), 'throng-us7-cfg-'));
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ editor: { openTarget: 'new' } }, null, 2));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'US7New', root);
        const tree = win.getByTestId('file-explorer-tree');
        // openOnClick defaults to 'single' → a single click opens the file.
        await tree.getByText('a.txt', { exact: true }).click();
        await expect(editors(win)).toHaveCount(1);
        await tree.getByText('b.txt', { exact: true }).click();
        await expect(editors(win)).toHaveCount(2); // a NEW editor, not a reuse
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(cfg, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('with "Last Active Editor" (default), opens reuse one editor (#141)', async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'US7Reuse', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('a.txt', { exact: true }).click();
      await expect(editors(win)).toHaveCount(1);
      await tree.getByText('b.txt', { exact: true }).click();
      await expect(editors(win)).toHaveCount(1); // reused; now showing b.txt
      await expect(editors(win).first()).toContainText('BBB');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
