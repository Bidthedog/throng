import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// Delivery A (US1/US3/US4/US5/US8-pills): a usable editor — create → type →
// Ctrl+S (confined) → new-doc LF default → Ctrl+Shift+S scope → Files-pane active
// gates Ctrl+S → dirty file locked → type + filename pills. Encoding-preservation
// on an *opened* file is covered in editor-open.e2e.ts (open-from-tree is Delivery B).

/** Stub the native save dialog to return `picked` (or cancel when omitted). */
async function stubSaveDialog(app: ElectronApplication, picked?: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () =>
      p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
  }, picked);
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

async function typeInto(win: Page, pid: string, text: string): Promise<void> {
  const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
  await content.click();
  await win.keyboard.type(text);
}

test('creates an editor, types, saves within the tree, and shows type + file pills', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-ed-'));
  const savePath = join(root, 'note.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'EditProj', root);
      const pid = await newEditor(win);

      // Type pill reads the registry label.
      // The type is now shown as a themeable icon; its name lives in the hover title.
      await expect(win.getByTestId(`panel-kind-${pid}`)).toHaveAttribute('title', /Editor Panel/);

      await typeInto(win, pid, 'hello\nworld\n');
      // Editing marks the Panel unsaved (shared dot).
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Ctrl+S on a new doc → save-location chooser (stubbed in-tree) → written LF.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');

      await expect
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf8') : ''), { timeout: 8000 })
        .toBe('hello\nworld\n');
      // New-doc default line ending is LF (no CRLF on disk).
      expect(readFileSync(savePath).includes(0x0d)).toBe(false);
      // Saving clears the unsaved dot and shows the filename pill.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-file-${pid}`)).toContainText('note.txt');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('refuses an out-of-tree save and leaves the buffer unsaved', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-ed-'));
  const outside = mkdtempSync(join(tmpdir(), 'throng-out-'));
  const escapePath = join(outside, 'escape.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'EditProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'secret');

      await stubSaveDialog(app, escapePath);
      await win.keyboard.press('Control+s');

      // Nothing is written outside the project tree; the buffer stays unsaved.
      await win.waitForTimeout(500);
      expect(existsSync(escapePath)).toBe(false);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the Files & Folders pane gates Ctrl+S (no-op) and highlights when active', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-ed-'));
  const savePath = join(root, 'gated.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'EditProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'unsaved edits');

      // Click the Files & Folders pane → it becomes the active pane (highlighted).
      await win.getByTestId('files-pane').click();
      await expect(win.getByTestId('files-pane')).toHaveAttribute('data-active-pane', 'true');
      // The highlight border is an overlay pseudo-element rendered ABOVE the tree
      // row selection box (FR-071) — assert the ::after border + its stacking.
      const overlay = await win.getByTestId('files-pane').evaluate((el) => {
        const s = getComputedStyle(el, '::after');
        return { border: s.borderTopWidth, z: s.zIndex, pe: s.pointerEvents };
      });
      expect(overlay.border).toBe('2px');
      expect(Number(overlay.z)).toBeGreaterThan(0);
      expect(overlay.pe).toBe('none'); // never intercepts clicks on the tree

      // Ctrl+S is now a no-op — no save dialog runs, nothing is written.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');
      await win.waitForTimeout(400);
      expect(existsSync(savePath)).toBe(false);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('warns (does not lock) when a dirty saved file changes on disk; Save-All writes the scope', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-ed-'));
  const savePath = join(root, 'watched.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'EditProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'v1');

      // Save once so the doc is pathed.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');
      await expect
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf8') : ''), { timeout: 8000 })
        .toBe('v1');

      // Edit again → dirty. There is NO lock now: an external write SUCCEEDS…
      await typeInto(win, pid, ' more');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
      let externalWriteSucceeded = true;
      try {
        writeFileSync(savePath, 'EXTERNAL');
      } catch {
        externalWriteSucceeded = false;
      }
      expect(externalWriteSucceeded).toBe(true);

      // …and throng surfaces a soft "changed on disk" notice (FR-028), keeping the buffer.
      await expect(win.getByTestId('editor-notice-dialog')).toBeVisible({ timeout: 8000 });
      await expect(win.getByTestId('editor-notice-message')).toContainText('changed');
      await win.getByTestId('editor-notice-ok').click();

      // Ctrl+Shift+S (Save-All, project scope) writes the edited buffer (overwrites
      // the external change — last-write-wins, like VS Code).
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Shift+S');
      await expect
        .poll(() => readFileSync(savePath, 'utf8'), { timeout: 8000 })
        .toContain('more');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
