/**
 * 044 FR-022 and FR-110 — a parented preview synced into a sub-workspace window is ONE preview in two
 * windows: it follows its parent being typed into in the main window, and a step through its history
 * taken in one window moves it in the other (research R22).
 *
 * ══ WHY THIS IS AN E2E (`@reserve:window`) ══
 *
 * Two windows are the assertion. The sub-workspace window is a second `BrowserWindow` with its own
 * renderer, its own preview store and its own subscription to `throng:preview:update`; the claim is
 * about what that second renderer ends up SHOWING when something happens in the first. Below this
 * layer, `integration/preview-service-*.test.ts` pins that main sends identical revisions to every
 * viewer and `component/history-mirror-sync.test.ts` what a view does with a history change when one
 * arrives — neither can make a second window exist and then ask what it is showing.
 *
 * ══ WHY THE BACK STEP LANDS ON A PARENTED ENTRY ══
 *
 * The preview starts on README, parented to an editor that has been typed into, follows a link to
 * setup (which unparents it, FR-090a), and is stepped Back in the SUB-WORKSPACE window. Arriving on
 * README again, it shows the editor's UNSAVED text — so the main window's preview reading "Typed in the
 * main window" after a key pressed in the other window proves three things at once: the step reached
 * main, main moved the one position, and the update came back to a window that never pressed anything.
 *
 * ══ TIER ══
 *
 * A header context menu (Sync to) and a second window: `parallel-plan.json`'s serial tier, as FOCUS.
 */
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  focusEditor,
  cleanupTemp,
  NEW_WINDOW_TIMEOUT_MS,
  type OpenApp,
} from './harness.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/preview/', import.meta.url));
const TYPED = 'Typed in the main window';

let shared: OpenApp;
let projectSeq = 0;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

/** Close a child window, tolerating one that has already gone. */
async function closeIfOpen(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    await page.close();
  } catch {
    /* already gone — which is the state this wanted */
  }
}

/** Sync `panelId` into a NEW sub-workspace, returning the window it opened. */
async function syncToNewSubWorkspace(win: Page, panelId: string): Promise<Page> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  await win.getByTestId('menu-item-Sync to').click();
  const [child] = await Promise.all([
    shared.app.waitForEvent('window', { timeout: NEW_WINDOW_TIMEOUT_MS }),
    win.getByTestId('menu-item-New Sub-workspace').click(),
  ]);
  await child.waitForLoadState('domcontentloaded');
  return child;
}

test('a parented preview synced into a sub-workspace follows its parent typed into in the main window, and Back in one window moves the other (FR-022, FR-110)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const { win } = shared;
  const root = mkdtempSync(join(tmpdir(), 'throng-preview-sub-'));
  cpSync(join(FIXTURES, 'links'), root, { recursive: true });
  let child: Page | undefined;
  try {
    await createProject(win, `PreviewSub-${(projectSeq += 1)}`, root);
    const editorId = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${editorId}`).click();
    const editor = win.getByTestId(`editor-${editorId}`);
    await expect(editor).toBeVisible();
    await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
    await expect(editor.locator('.cm-content')).toContainText('Links fixture', { timeout: 8000 });

    // A parented preview of README, beside its editor.
    const before = await win
      .locator('[data-testid^="preview-body-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    await win.getByTestId(`editor-preview-${editorId}`).click();
    let previewId = '';
    await expect
      .poll(async () => {
        const ids = await win
          .locator('[data-testid^="preview-body-"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
        previewId = (ids.find((id) => !before.includes(id)) ?? '').replace('preview-body-', '');
        return previewId !== '';
      })
      .toBe(true);
    const mainPreview = win.getByTestId(`preview-markdown-${previewId}`);
    await expect(mainPreview).toContainText('Links fixture');

    /* ── The same preview, in a second window ──────────────────────────────────────────────────── */
    child = await syncToNewSubWorkspace(win, previewId);
    const childPreview = child.getByTestId(`preview-markdown-${previewId}`);
    await expect(childPreview).toContainText('Links fixture', { timeout: 20_000 });
    await expect(childPreview).not.toContainText(TYPED);

    /* ── FR-022: typing into the parent in the MAIN window reaches the sub-workspace's view ───── */
    await focusEditor(win, editorId);
    await win.keyboard.press('Control+Home');
    await win.keyboard.type(`${TYPED}\n\n`, { delay: 10 });
    await expect(childPreview).toContainText(TYPED, { timeout: 10_000 });
    await expect(mainPreview).toContainText(TYPED);

    /* ── History: README → setup, followed in the main window ──────────────────────────────────── */
    await mainPreview.getByText('Setup', { exact: true }).click({ modifiers: ['Control'] });
    await expect(mainPreview).toContainText('Setup fixture');
    // One preview, one position: the other window moved with it.
    await expect(childPreview).toContainText('Setup fixture', { timeout: 10_000 });
    await expect(child.getByTestId(`panel-back-${previewId}`)).toBeEnabled({ timeout: 10_000 });

    /* ── FR-110: Back pressed in the SUB-WORKSPACE window moves the MAIN window's preview ──────── */
    await childPreview.getByText('Introductory text for the setup fixture', { exact: false }).click();
    await child.keyboard.press('Alt+ArrowLeft');
    await expect(mainPreview).toContainText('Links fixture', { timeout: 10_000 });
    await expect(mainPreview).not.toContainText('Setup fixture');
    // README again, parented again: the editor's UNSAVED text, which only the one position moving could
    // have brought back to a window that pressed nothing.
    await expect(mainPreview).toContainText(TYPED);
    await expect(childPreview).toContainText(TYPED, { timeout: 10_000 });
    await expect(win.getByTestId(`panel-forward-${previewId}`)).toBeEnabled({ timeout: 10_000 });
  } finally {
    if (child) await closeIfOpen(child);
    cleanupTemp(root);
  }
});
