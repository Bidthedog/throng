/**
 * 075 SC-012, SC-013, FR-064, FR-068, FR-070, FR-071 — Print Preview as a real window.
 *
 * ══ WHY THIS IS AN E2E ══
 *
 * What is under test is a second BrowserWindow: that Ctrl+P in a preview opens exactly one, that a second Ctrl+P
 * opens no other, that Chromium's print engine lays pages out inside it, and that what was chosen there is on disk
 * for the next launch. The controller's rules (one job, nothing printed unseen, settings saved on close) are
 * proven against a recording engine in `integration/print-controller.test.ts`; the controls in
 * `component/print-preview-app.test.ts`. This only asks the real window to agree, once. It never prints: a hosted
 * runner may have no printer, and Print Preview says so rather than failing.
 *
 * Its own app, launched twice over one user-data folder, because the second launch is the assertion.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, type OpenApp } from './harness.js';

let root = '';
let userDataDir = '';

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-print-preview-'));
  userDataDir = mkdtempSync(join(tmpdir(), 'throng-print-preview-ud-'));
  writeFileSync(join(root, 'doc.md'), `# Printable\n\n${'A paragraph of words to lay out on paper. '.repeat(40)}\n\n> [!note] Kept\n> Inside a callout.\n`);
});

test.afterAll(() => {
  if (root) cleanupTemp(root);
  if (userDataDir) cleanupTemp(userDataDir);
});

/** Open `doc.md` in an editor, then its preview; the preview panel's id. */
async function openPreview(win: Page): Promise<string> {
  const editorId = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${editorId}`).click();
  await win.getByTestId('file-explorer-tree').getByText('doc.md', { exact: true }).click();
  await expect(win.getByTestId(`editor-${editorId}`).locator('.cm-content')).toContainText('Printable', { timeout: 8000 });
  await win.getByTestId(`editor-preview-${editorId}`).click();
  const body = win.locator('[data-testid^="preview-body-"]').first();
  await expect(body).toContainText('Inside a callout.', { timeout: 8000 });
  return ((await body.getAttribute('data-testid')) ?? '').replace('preview-body-', '');
}

/** The Print Preview windows open now. */
function printWindows(app: ElectronApplication): Page[] {
  return app.windows().filter((w) => w.url().includes('printPreview='));
}

async function openPrintPreview(app: ElectronApplication, win: Page, previewId: string): Promise<Page> {
  await win.getByTestId(`preview-body-${previewId}`).click();
  const next = app.waitForEvent('window', { predicate: (w) => w.url().includes('printPreview='), timeout: 10_000 });
  await win.keyboard.press('Control+P');
  const print = await next;
  await expect(print.getByTestId('print-preview')).toBeVisible({ timeout: 10_000 });
  return print;
}

test('Ctrl+P opens one modal Print Preview whose pages render, and its settings outlive a relaunch', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  let first: OpenApp | undefined = await openApp({ userDataDir });
  try {
    await createProject(first.win, 'PrintPreview', root);
    const previewId = await openPreview(first.win);
    const print = await openPrintPreview(first.app, first.win, previewId);
    // FR-068 — the pages are laid out by the print engine and counted.
    await expect(print.getByTestId('print-status')).toHaveText(/^\d+ pages?$/, { timeout: 15_000 });

    // FR-071 — a second Print… opens no second window.
    await first.win.keyboard.press('Control+P');
    await expect.poll(() => printWindows(first!.app).length, { timeout: 3000 }).toBe(1);

    // FR-070 — what was chosen is saved on close (Cancel), the page range excepted.
    await print.getByTestId('print-orientation').selectOption('landscape');
    await expect(print.getByTestId('print-status')).toHaveText(/^\d+ pages?$/, { timeout: 15_000 });
    await print.getByTestId('print-close').click();
    await expect.poll(() => printWindows(first!.app).length, { timeout: 5000 }).toBe(0);
  } finally {
    await first?.close();
    first = undefined;
  }

  const second = await openApp({ userDataDir });
  try {
    await createProject(second.win, 'PrintPreview2', root);
    const previewId = await openPreview(second.win);
    const print = await openPrintPreview(second.app, second.win, previewId);
    await expect(print.getByTestId('print-orientation')).toHaveValue('landscape');
  } finally {
    await second.close();
  }
});
