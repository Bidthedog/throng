/**
 * US5 (#158) + FR-018a — the Files & Folders menu groups items into sections with separators, and
 * "Open in OS Explorer" is the FIRST item of the "Open In" submenu (folders get just that).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';

function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-us5-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

test('"Open in OS Explorer" leads the "Open In" submenu; the menu has section separators (#158)', async () => {
  const root = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'US5', root);
      const tree = win.getByTestId('file-explorer-tree');

      // A FILE: the menu is grouped into sections (FR-018a).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      /*
       * Wait for the menu, then assert with a RETRYING expectation.
       *
       * `await locator.count()` is a single instantaneous read — it does not retry — so this asked
       * how many separators existed the moment after the right-click, before the menu had rendered.
       * It reddened CI (run 30951944889) while passing every time locally, which is the signature of
       * a load-sensitive assertion rather than a broken feature.
       */
      await expect(win.locator('.context-menu')).toBeVisible();
      await expect(win.locator('.context-menu__separator').first()).toBeVisible();

      // "OS File Explorer" is not a top-level item — it lives in "Open In".
      await expect(win.getByTestId('menu-item-OS File Explorer')).toHaveCount(0);
      await win.getByTestId('menu-item-Open In').click();
      const fileSub = win.getByTestId('submenu-Open In');
      await expect(fileSub.locator('.context-menu__item').first()).toContainText('OS File Explorer');

      /*
       * A FOLDER: its "Open In" holds the OS reveal and 033 US3's Terminal submenu — and no editor
       * targets, which is what this assertion has always been about.
       *
       * The count moved from one to two on purpose, and this is SC-011's sole named exception (spec
       * 033, FR-029): US3 nests Terminal inside this very submenu for folders and files alike. Any
       * OTHER menu spec that needs editing for that feature is a defect in the builder, not a test
       * that had gone stale. The leading item is still the OS reveal, which is the ordering #158
       * fixed.
       */
      await tree.getByText('src', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      const folderSub = win.getByTestId('submenu-Open In');
      await expect(folderSub.locator('.context-menu__item')).toHaveCount(2);
      await expect(folderSub.locator('.context-menu__item').first()).toContainText('OS File Explorer');
      await expect(folderSub.locator('.context-menu__item').nth(1)).toContainText('Terminal');
    });
  } finally {
    cleanupTemp(root);
  }
});
