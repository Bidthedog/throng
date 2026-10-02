/**
 * 049 FR-000a, US6 — a panel synced into a sub-workspace window arrives in the state it was left in: the editor's
 * selection is still selected, and the find session (term, and the current match) is still open on it.
 *
 * ══ WHY THIS IS AN E2E (`@reserve:window`) ══
 *
 * A second `BrowserWindow` has its own renderer and none of the first one's module state, so the claim is about what
 * a renderer that has never seen the panel ends up showing. Below this layer the pieces are pinned one by one —
 * `component/panel-state-capture.test.ts` (what is captured and sent), `component/editor-handoff-capture.test.ts` and
 * `component/terminal-handoff-capture.test.ts` (what a view reports and restores), `detach-handoff-order.test.ts`
 * (the stash lands before the window opens) — and none of them can make the window exist and then ask it.
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

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

async function closeIfOpen(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    await page.close();
  } catch {
    /* already gone — which is the state this wanted */
  }
}

test('an editor synced into a new sub-workspace window keeps its selection and its open find session (FR-000a)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const { win } = shared;
  const root = mkdtempSync(join(tmpdir(), 'throng-state-xwin-'));
  cpSync(join(FIXTURES, 'links'), root, { recursive: true });
  let child: Page | undefined;
  try {
    await createProject(win, 'StateAcrossWindows', root);
    const editorId = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${editorId}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${editorId}`).click();
    const editor = win.getByTestId(`editor-${editorId}`);
    await expect(editor).toBeVisible();
    await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
    await expect(editor.locator('.cm-content')).toContainText('Links fixture', { timeout: 8000 });

    // A selection of the first line, and a find session over a term that is in the file.
    await focusEditor(win, editorId);
    await win.keyboard.press('Control+Home');
    await win.keyboard.press('Shift+End');
    await win.keyboard.press('Control+f');
    const input = win.getByTestId(`find-bar-${editorId}`).getByTestId('find-input');
    await expect(input).toBeFocused();
    // A term whose count differs from the seed's: Ctrl+F seeded the selected first line ("1 of 1"), and the typed
    // term reaches the session only after the as-you-type debounce. Waiting on "of 4" is what proves it has landed
    // before the move; a term that also counted 1 of 1 let the move carry the seed (the first gate run, 8ca1dfbc).
    await input.fill('setup');
    await expect(win.getByTestId(`find-bar-${editorId}`).getByTestId('find-count')).toHaveText(/of 4$/);
    const count = await win.getByTestId(`find-bar-${editorId}`).getByTestId('find-count').innerText();

    // Sync the panel into a NEW sub-workspace: a second window whose renderer has never seen it.
    await win.getByTestId(`panel-handle-${editorId}`).click({ button: 'right' });
    await win.getByTestId('menu-item-Sync to').click();
    [child] = await Promise.all([
      shared.app.waitForEvent('window', { timeout: NEW_WINDOW_TIMEOUT_MS }),
      win.getByTestId('menu-item-New Sub-workspace').click(),
    ]);
    await child.waitForLoadState('domcontentloaded');

    const childEditor = child.getByTestId(`editor-${editorId}`);
    await expect(childEditor.locator('.cm-content')).toContainText('Links fixture', { timeout: 20_000 });

    // The find session crossed: the bar is open on the same term with the same count.
    const childInput = child.getByTestId(`find-bar-${editorId}`).getByTestId('find-input');
    await expect(childInput).toHaveValue('setup', { timeout: 10_000 });
    await expect(child.getByTestId(`find-bar-${editorId}`).getByTestId('find-count')).toHaveText(count);

    // The selection crossed: the first line is still selected in the new window's editor.
    await expect(childEditor.locator('.cm-selectionBackground').first()).toBeVisible({ timeout: 10_000 });
  } finally {
    if (child) await closeIfOpen(child);
    cleanupTemp(root);
  }
});
