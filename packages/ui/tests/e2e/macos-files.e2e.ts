import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { FILE_OP_TIMEOUT_MS, cleanupTemp, createProject, openedPaths, runApp } from './harness.js';

/**
 * Layer: E2E. macOS's real file system and services through the real tree (070 SC-007, US3 scenarios 1–4): a case-only
 * rename on case-insensitive APFS, a delete into the real Trash and its undo, a copy onto the real pasteboard (read
 * back through `osascript`, since the harness's in-memory clipboard is turned off here), and Finder's reveal and open
 * handlers reached through the shell seam. The Trash layout, the pasteboard codec and the path rules are proven at
 * the contract and unit layers; this is the path through the app. macOS's own lane: `@macos` only.
 */
test.skip(process.platform !== 'darwin', 'macOS file behaviour');

/** Under the runner's home, not `$TMPDIR`, so a delete goes to the user's Trash as a real one would. */
function project(): { base: string; root: string } {
  const base = join(homedir(), 'throng-e2e-files');
  mkdirSync(base, { recursive: true });
  return { base, root: realpathSync(mkdtempSync(join(base, 'files-'))) };
}

test('a name changed only in case is a rename, not a clash', { tag: ['@macos', '@extended', '@explorer', '@reserve:runtime'] }, async () => {
  const { base, root } = project();
  writeFileSync(join(root, 'readme.md'), 'x');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Case', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('readme.md', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Rename').click();
      const input = tree.locator('input.tree-rename');
      await input.fill('README.md');
      await input.press('Enter');
      await expect(tree.getByText('README.md', { exact: true })).toBeVisible();
      await expect.poll(() => readdirSync(root), { timeout: FILE_OP_TIMEOUT_MS }).toEqual(['README.md']);
    });
  } finally {
    cleanupTemp(root);
    rmSync(base, { recursive: true, force: true });
  }
});

test('a deleted file goes to the Trash and Undo brings it back', { tag: ['@macos', '@extended', '@explorer', '@reserve:native'] }, async () => {
  const { base, root } = project();
  writeFileSync(join(root, 'gone.txt'), 'gone');
  writeFileSync(join(root, 'other.txt'), 'other');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Trash', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('gone.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Delete').click();
      await expect(win.getByTestId('confirm-dialog')).toContainText('Trash');
      await win.getByTestId('confirm-accept').click();
      await expect.poll(() => existsSync(join(root, 'gone.txt')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(false);

      // The file leaves before the delete's answer arrives (the Trash is moved by osascript), and the undo entry is
      // recorded with the answer; a menu opened in between is built with Undo off. Reopen until it is offered.
      const undo = win.getByRole('menuitem', { name: /^Undo / });
      await expect
        .poll(async () => {
          await tree.getByText('other.txt', { exact: true }).click({ button: 'right' });
          if ((await undo.getAttribute('aria-disabled')) !== 'true') return true;
          await win.keyboard.press('Escape');
          return false;
        }, { timeout: FILE_OP_TIMEOUT_MS })
        .toBe(true);
      await undo.click();
      await expect.poll(() => existsSync(join(root, 'gone.txt')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
    });
  } finally {
    cleanupTemp(root);
    rmSync(base, { recursive: true, force: true });
  }
});

test('copied files reach the macOS pasteboard as files', { tag: ['@macos', '@extended', '@explorer', '@reserve:native'] }, async () => {
  const { base, root } = project();
  writeFileSync(join(root, 'one.txt'), '1');
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Pasteboard', root);
        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('one.txt', { exact: true }).click({ button: 'right' });
        await win.getByTestId('menu-item-Copy').click();
        // The pasteboard's file URL, read the way any other app reads it.
        const read = (): string => {
          try {
            return execFileSync('osascript', ['-e', 'POSIX path of (the clipboard as «class furl»)'], { encoding: 'utf8' }).trim();
          } catch {
            return '';
          }
        };
        await expect.poll(read, { timeout: FILE_OP_TIMEOUT_MS }).toBe(join(root, 'one.txt'));
      },
      // The real pasteboard, not the harness's in-memory stand-in: this test exists to read what macOS holds.
      { env: { THRONG_E2E_CLIPBOARD: 'system' } },
    );
  } finally {
    cleanupTemp(root);
    rmSync(base, { recursive: true, force: true });
  }
});

test('reveal and open-with-default go to Finder’s handlers', { tag: ['@macos', '@extended', '@explorer', '@reserve:runtime'] }, async () => {
  const { base, root } = project();
  writeFileSync(join(root, 'notes.txt'), 'n');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'Finder', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('notes.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await win.getByTestId('menu-item-OS File Explorer').click();
      await tree.getByText('notes.txt', { exact: true }).click({ button: 'right' });
      await win.getByTestId('menu-item-Open In').click();
      await win.getByTestId('menu-item-Open in OS Default Program').click();
      await expect.poll(() => openedPaths(app)).toEqual([join(root, 'notes.txt'), join(root, 'notes.txt')]);
    });
  } finally {
    cleanupTemp(root);
    rmSync(base, { recursive: true, force: true });
  }
});
