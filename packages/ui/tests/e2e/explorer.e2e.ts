/**
 * E2E (004, T019) — the File Explorer tree renders the active project's folder,
 * sorts folders-first, hides excluded entries, expands subfolders lazily, and
 * supports the level-by-level Expand + selectable root. Drives the real Electron
 * app via the shared harness.
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

/** react-dnd's empty drag-preview image trips the app's CSP harmlessly; ignore it. */
const realErrors = (errors: string[]): string[] =>
  errors.filter((e) => !e.includes('Content Security Policy') && !e.includes('data:image'));
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp, createProject } from './harness.js';

/** Build a known project folder structure on disk. Returns its absolute path. */
function makeProjectFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-proj-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  mkdirSync(join(root, 'src', 'inner'));
  writeFileSync(join(root, 'src', 'inner', 'deep.ts'), '//\n');
  mkdirSync(join(root, '.git')); // must be hidden by the default exclude globs
  writeFileSync(join(root, 'README.md'), '# demo\n');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  return root;
}

test('renders the active project tree: sorted, excludes hidden, lazy expand', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      const errors: string[] = [];
      win.on('pageerror', (e) => errors.push(String(e)));
      win.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await createProject(win, 'Demo', projectRoot);

      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Root row + top-level entries are present; .git is excluded.
      await expect(tree.getByText('src', { exact: true })).toBeVisible();
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible();
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();
      await expect(tree.getByText('.git', { exact: true })).toHaveCount(0);

      // Subfolders start collapsed.
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // Click the folder → it expands and its children appear (lazy load).
      await tree.getByText('src', { exact: true }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await expect(tree.getByText('inner', { exact: true })).toBeVisible();

      expect(realErrors(errors), `renderer errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('Expand button steps levels; Collapse all resets to level 1', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand (nothing selected → level 1): src opens? No — level 1 just opens
      // top-level folders. `src` opens, `inner` (level 2) stays hidden.
      await win.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await expect(tree.getByText('inner', { exact: true })).toBeVisible();
      await expect(tree.getByText('deep.ts', { exact: true })).toHaveCount(0);

      // Second Expand → level 2 (inner opens).
      await win.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByText('deep.ts', { exact: true })).toBeVisible();

      // Collapse all → back to just the top level.
      await win.getByRole('button', { name: 'Collapse all' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('collapsing the tree raises no error (no bogus internal-root path)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      const errors: string[] = [];
      win.on('pageerror', (e) => errors.push(String(e)));
      win.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand two levels, then Collapse all (the action that triggered the bug).
      await win.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await win.getByRole('button', { name: 'Expand' }).click();
      await expect(tree.getByText('deep.ts', { exact: true })).toBeVisible();
      await win.getByRole('button', { name: 'Collapse all' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // No error banner and no realpath/internal-root error must appear.
      await win.waitForTimeout(500);
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
      expect(realErrors(errors), `errors:\n${errors.join('\n')}`).toEqual([]);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('reflects external filesystem changes live, preserving expansion (US2)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand `src` so its directory is loaded + visible.
      await tree.getByText('src', { exact: true }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();

      // External create inside the expanded folder → appears live, no refresh.
      writeFileSync(join(projectRoot, 'src', 'fresh.ts'), 'export const y = 2;\n');
      await expect(tree.getByText('fresh.ts', { exact: true })).toBeVisible();
      // `src` stayed expanded across the live update.
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();

      // External create at the root → appears live.
      writeFileSync(join(projectRoot, 'top.md'), '# top\n');
      await expect(tree.getByText('top.md', { exact: true })).toBeVisible();

      // External delete → vanishes live.
      rmSync(join(projectRoot, 'src', 'index.ts'), { force: true });
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('file operations via context menu + toolbar (US3): delete, new folder, cut/paste, rename', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      // Default delete mode = Recycle Bin: the real shell.trashItem removes the
      // entry from the live folder (→ observable in the tree).
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      const menuItem = (label: string) => win.locator('.context-menu__item', { hasText: label });

      // Delete a.txt (default = Recycle Bin) via the context menu → confirm → vanishes.
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await menuItem('Delete').click();
      await win.getByTestId('confirm-accept').click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);

      // New folder via the toolbar → appears and enters inline rename; name it.
      await win.getByRole('button', { name: 'New folder' }).click();
      const rename = tree.locator('input.tree-rename');
      await expect(rename).toBeVisible();
      await rename.fill('assets');
      await rename.press('Enter');
      await expect(tree.getByText('assets', { exact: true })).toBeVisible();

      // Cut README.md, paste into `assets` → it moves there.
      await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
      await menuItem('Cut').click();
      await tree.getByText('assets', { exact: true }).click({ button: 'right' });
      await menuItem('Paste').click();
      await tree.getByText('assets', { exact: true }).click(); // expand
      // Exactly one README.md remains (under assets) — it MOVED, not copied. The
      // count retries while the watcher re-reads the root and drops the stale row.
      await expect(tree.locator('.tree-label', { hasText: 'README.md' })).toHaveCount(1);
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible();

      // Rename `assets` → `media` via the context menu.
      await tree.getByText('assets', { exact: true }).click({ button: 'right' });
      await menuItem('Rename').click();
      const rename2 = tree.locator('input.tree-rename');
      await rename2.fill('media');
      await rename2.press('Enter');
      await expect(tree.getByText('media', { exact: true })).toBeVisible();
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('keyboard shortcuts operate on the tree: Del deletes, F2 renames (US3)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Select a.txt and press Delete → confirm → it vanishes.
      await tree.getByText('a.txt', { exact: true }).click();
      await win.keyboard.press('Delete');
      await win.getByTestId('confirm-accept').click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);

      // Select README.md, press F2 → inline rename; commit a new name.
      await tree.getByText('README.md', { exact: true }).click();
      await win.keyboard.press('F2');
      const rename = tree.locator('input.tree-rename');
      await expect(rename).toBeVisible();
      await rename.fill('readme2.md');
      await rename.press('Enter');
      await expect(tree.getByText('readme2.md', { exact: true })).toBeVisible();
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('copy/paste duplicates with a non-clobbering name; open-in-explorer raises no error (US3)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (app, win) => {
      // No-op the OS reveal/open so the test doesn't pop a real file manager.
      await app.evaluate(({ shell }) => {
        shell.showItemInFolder = () => {};
        shell.openPath = async () => '';
      });
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      const menuItem = (label: string) => win.locator('.context-menu__item', { hasText: label });

      // Copy README.md, paste at the root → a de-duplicated "README copy.md".
      await tree.getByText('README.md', { exact: true }).click({ button: 'right' });
      await menuItem('Copy').click();
      await tree.locator('.tree-row--root').click({ button: 'right' });
      await menuItem('Paste').click();
      await expect(tree.getByText('README copy.md', { exact: true })).toBeVisible();
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible(); // original kept

      // Reveal a file in the OS explorer → no error banner. The reveal is a single
      // top-level "Open in OS File Explorer" item for files and folders alike (FR-107).
      await win.keyboard.press('Escape'); // dismiss any lingering menu
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open in OS File Explorer').click();
      await win.waitForTimeout(300);
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('drag-and-drop moves a file into a folder (US3b)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Drag README.md onto the `src` folder → it moves there.
      await tree
        .getByText('README.md', { exact: true })
        .dragTo(tree.getByText('src', { exact: true }));

      // Assert the MOVE on disk — deterministic, unlike the tree's post-drop expand
      // state (react-arborist may leave `src` collapsed, hiding the moved node). It
      // moved, not copied: README.md is under src/ and no longer at the root.
      await expect
        .poll(() => existsSync(join(projectRoot, 'src', 'README.md')), { timeout: 10000 })
        .toBe(true);
      expect(existsSync(join(projectRoot, 'README.md'))).toBe(false);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('multi-select (Ctrl-click) then Delete removes all selected (US3b)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Select a.txt, then Ctrl-click README.md to add it to the selection.
      await tree.getByText('a.txt', { exact: true }).click();
      await tree.getByText('README.md', { exact: true }).click({ modifiers: ['Control'] });
      await expect(tree.locator('.tree-row--selected')).toHaveCount(2);

      // Delete → confirm once → both removed.
      await win.keyboard.press('Delete');
      await win.getByTestId('confirm-accept').click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);
      await expect(tree.getByText('README.md', { exact: true })).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('delete confirmation can be cancelled; the toolbar Delete button works (US3 polish)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Cancel the confirmation → the file stays.
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await win.locator('.context-menu__item', { hasText: 'Delete' }).click();
      await expect(win.getByTestId('confirm-dialog')).toBeVisible();
      await win.getByTestId('confirm-cancel').click();
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();

      // Toolbar Delete button → confirm → gone.
      await tree.getByText('a.txt', { exact: true }).click();
      await win.getByRole('button', { name: 'Delete' }).click();
      await win.getByTestId('confirm-accept').click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('cut greys the item; Escape clears the clipboard (US3 polish)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await win.locator('.context-menu__item', { hasText: 'Cut' }).click();
      await expect(tree.locator('.tree-row--cut', { hasText: 'a.txt' })).toBeVisible();

      // Focus the tree, press Escape → the cut is cancelled (no longer greyed).
      await tree.getByText('a.txt', { exact: true }).click();
      await win.keyboard.press('Escape');
      await expect(tree.locator('.tree-row--cut')).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('New folder in a collapsed folder expands it and overwrites the selected name (US3 polish)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Select `src` then collapse it again (still selected, now minimised).
      await tree.getByText('src', { exact: true }).click(); // expand + select
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await tree.getByText('src', { exact: true }).click(); // collapse
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // New folder → src expands and the new folder is in rename mode.
      await win.getByRole('button', { name: 'New folder' }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible(); // src re-expanded
      const rename = tree.locator('input.tree-rename');
      await expect(rename).toBeVisible();

      // The default name is fully selected → typing overwrites it entirely.
      await win.keyboard.type('models');
      await rename.press('Enter');
      await expect(tree.getByText('models', { exact: true })).toBeVisible();
      await expect(tree.getByText('New folder', { exact: true })).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('right-click Hide removes the item from this project view (US3 hide)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await expect(tree.getByText('a.txt', { exact: true })).toBeVisible();

      // Hide a.txt → it disappears from the view (still on disk, just hidden).
      await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
      await win.locator('.context-menu__item', { hasText: 'Hide in this project' }).click();
      await expect(tree.getByText('a.txt', { exact: true })).toHaveCount(0);
      // Other entries are unaffected.
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible();
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const installOpenListener = (win: import('@playwright/test').Page): Promise<void> =>
  win.evaluate(() => {
    (globalThis as Record<string, unknown>).__opens = [];
    window.addEventListener('throng:open-file', (e) =>
      (
        (globalThis as Record<string, unknown>).__opens as unknown[]
      ).push((e as CustomEvent).detail),
    );
  });
const openCount = (win: import('@playwright/test').Page): Promise<number> =>
  win.evaluate(() => ((globalThis as Record<string, unknown>).__opens as unknown[]).length);

test('single-click opens a file (default); a folder click toggles, never opens (US4)', async () => {
  const projectRoot = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Demo', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await installOpenListener(win);

      // Single click on a file → exactly one open-file intent for its path.
      await tree.getByText('a.txt', { exact: true }).click();
      await expect.poll(() => openCount(win)).toBe(1);
      const opens = await win.evaluate(
        () => (globalThis as Record<string, unknown>).__opens as Array<{ relPath: string }>,
      );
      expect(opens[0].relPath).toBe('a.txt');

      // Clicking a folder toggles it and raises NO open intent.
      await tree.getByText('src', { exact: true }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await win.waitForTimeout(150);
      expect(await openCount(win)).toBe(1);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('double-click mode: a single click only selects; a double click opens (US4)', async () => {
  const projectRoot = makeProjectFolder();
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-dbl-'));
  // 006 moved the file-open-on-click trigger from explorer.openMode to
  // editor.openOnClick (single | double | none); files now open into an editor.
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({ version: 1, editor: { openOnClick: 'double' } }),
  );
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Demo', projectRoot);
        const tree = win.getByTestId('file-explorer-tree');
        await expect(tree).toBeVisible();
        await installOpenListener(win);

        // Single click → selects only, no open intent.
        await tree.getByText('a.txt', { exact: true }).click();
        await win.waitForTimeout(250);
        expect(await openCount(win)).toBe(0);

        // Double click → exactly one open intent.
        await tree.getByText('a.txt', { exact: true }).dblclick();
        await expect.poll(() => openCount(win)).toBe(1);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a large folder stays responsive — virtualised rows (polish T061)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-big-'));
  mkdirSync(join(projectRoot, 'big'));
  for (let i = 0; i < 800; i += 1) {
    writeFileSync(join(projectRoot, 'big', `f-${String(i).padStart(4, '0')}.txt`), 'x');
  }
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Big', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      await tree.getByText('big', { exact: true }).click(); // expand 800 entries
      await expect(tree.getByText('f-0000.txt', { exact: true })).toBeVisible();

      // Virtualised: only a small window of rows is in the DOM, not all 800.
      const rows = await tree.locator('.tree-row').count();
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThan(200);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('an empty project folder shows the root with no children and no error (polish T062)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-empty-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Empty', projectRoot);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();
      await expect(tree.locator('.tree-row--root')).toBeVisible();
      await expect(tree.locator('.explorer__error')).toHaveCount(0);
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('remembers expansion + selection per project; root is selectable', async () => {
  const rootA = makeProjectFolder();
  const rootB = makeProjectFolder();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Alpha', rootA);
      const tree = win.getByTestId('file-explorer-tree');
      await expect(tree).toBeVisible();

      // Expand `src` and select README.md in Alpha.
      await tree.getByText('src', { exact: true }).click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await tree.getByText('README.md', { exact: true }).click();
      await expect(tree.locator('.tree-row--selected', { hasText: 'README.md' })).toBeVisible();

      // Create + switch to Beta — Alpha's tree unmounts; Beta starts collapsed.
      await createProject(win, 'Beta', rootB);
      await expect(tree.getByText('index.ts', { exact: true })).toHaveCount(0);

      // Switch back to Alpha → its expansion AND selection are restored.
      await win
        .locator('.project-item', { hasText: 'Alpha' })
        .locator('[data-testid^="project-switch-"]')
        .click();
      await expect(tree.getByText('index.ts', { exact: true })).toBeVisible();
      await expect(tree.locator('.tree-row--selected', { hasText: 'README.md' })).toBeVisible();

      // The root row is selectable (but stays expanded).
      await tree.locator('.tree-row--root').click();
      await expect(tree.locator('.tree-row--root.tree-row--selected')).toBeVisible();
      await expect(tree.getByText('src', { exact: true })).toBeVisible();
    });
  } finally {
    rmSync(rootA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(rootB, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
