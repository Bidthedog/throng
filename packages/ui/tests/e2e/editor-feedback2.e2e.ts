import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { openApp, createProject, firstPanelId, cleanupTemp, FILE_OP_TIMEOUT_MS, type OpenApp } from './harness.js';

// Session 2026-07-06 feedback: "This editor" rename + selected-editor disable
// (FR-082), New Folder tree menu (FR-086), Save As (FR-084), and the save-dialog
// default file name = Panel name (FR-083).

/*
 * ══ ONE APP FOR THE FILE (034 FR-045) ══
 *
 * Four tests, four `runApp()` calls, four Electron launches and four daemons. Nothing here seeds
 * state before the app starts — `makeProject()` is a `mkdtempSync` folder that reaches the app only
 * through in-app `createProject`, which is a filesystem fixture and not a launch seed — and nothing
 * relaunches. So the file shares one app.
 *
 * WHY SHARING IS SAFE HERE SPECIFICALLY, check by check:
 *
 *  • Assertions are RELATIVE. Each test asserts on the panel it made (`editor-${pid}`,
 *    `panel-handle-${pid}`), on a file under its own temp root, or on the ONE context menu that is
 *    open at that moment. There is no window-wide count for a leftover to change, and only the
 *    ACTIVE project renders, so the tree locators see this test's project and no other.
 *
 *  • NO PROJECT-NAME COLLISION — the one thing that had to be FIXED rather than merely checked. All
 *    four tests created a project called `Fb2` over four DIFFERENT temp roots; four launches hid it
 *    and one app cannot. They are named apart below and nothing else about them changed. The ROOTS
 *    were already fine: four sibling `throng-fb2-` temp dirs, so FR-029's identical/ancestor/
 *    descendant exclusivity rule cannot reject any of them.
 *
 *  • `dialog.showSaveDialog` is a permanent main-process swap — the irreversible global mutation to
 *    be afraid of — and it is harmless HERE BY CONSTRUCTION: tests 1 and 2 never invoke it, and
 *    tests 3 and 4 each install their own stub immediately before the action that triggers it, so no
 *    test can be answered by a neighbour's.
 *
 *  • Two tests end with transient UI still open — a context menu (test 1) and an inline tree-rename
 *    input (test 2). Both clear themselves harmlessly, and this was checked rather than assumed: the
 *    context menu has NO backdrop and closes from a window `pointerdown` listener that neither
 *    preventDefaults nor stops propagation, so the next click both closes it and reaches its target;
 *    and the provider keeps ONE menu open at a time, so a stale menu cannot make a later
 *    `.context-menu__item` locator ambiguous. The rename input commits on blur (FR-090) with its
 *    untouched value — a no-op rename.
 *
 *  • ORDERING: test 1 asks about the "Last Active Editor" entry, which reads a renderer singleton.
 *    It must stay FIRST, and declaration order plus `fullyParallel: false` guarantees that.
 *
 * Deliberately NOT `mode: 'serial'`. These four ask four independent questions — a disabled menu
 * entry, a New Folder action, Save As, a default file name — and a first failure that skipped the
 * rest would turn one of them into "something about the editor feedback is wrong".
 * `fullyParallel: false` already keeps the file to one worker, in order, so the shared app is never
 * driven by two tests at once.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-fb2-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'a.txt'), 'A-BODY\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

const item = (win: Page, label: string) => win.getByTestId(`menu-item-${label}`);

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
});

test('"This editor" is disabled when the file is already open in the target editor', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    const { win } = shared;
    await createProject(win, 'Fb2Disabled', root);
    const pid = await newEditor(win);
    await win.getByTestId(`editor-${pid}`).click();

    const tree = win.getByTestId('file-explorer-tree');
    await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
    await item(win, 'Open In').click();
    // Renamed from "Editor Here" (FR-082), enabled while not open.
    await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toBeVisible();
    await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).not.toHaveClass(/context-menu__item--disabled/);
    await win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last().click();
    await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('A-BODY', {
      timeout: 8000,
    });

    // Now the file is open in that editor → "This editor" is disabled (no-op).
    await tree.getByText('a.txt', { exact: true }).click({ button: 'right' });
    await item(win, 'Open In').click();
    await expect(win.locator('.context-menu__item', { hasText: 'Last Active Editor' }).last()).toHaveClass(/context-menu__item--disabled/);
  } finally {
    cleanupTemp(root);
  }
});

test('the Files & Folders context menu has a New Folder action', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    const { win } = shared;
    await createProject(win, 'Fb2NewFolder', root);
    const tree = win.getByTestId('file-explorer-tree');
    await tree.getByText('sub', { exact: true }).click({ button: 'right' });
    await expect(item(win, 'New Folder')).toBeVisible();
    await item(win, 'New Folder').click();
    // A new folder is created (inline rename input appears) and exists on disk.
    await expect(tree.locator('input.tree-rename')).toBeVisible({ timeout: 6000 });
    await expect
      .poll(() => existsSync(join(root, 'sub', 'New folder')), { timeout: FILE_OP_TIMEOUT_MS })
      .toBe(true);
  } finally {
    cleanupTemp(root);
  }
});

test('Save As writes the document to a newly chosen location', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  const first = join(root, 'first.txt');
  const second = join(root, 'second.txt');
  const stub = async (app: ElectronApplication, path: string): Promise<void> => {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, path);
  };
  try {
    const { app, win } = shared;
    await createProject(win, 'Fb2SaveAs', root);
    const pid = await newEditor(win);
    await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
    await win.keyboard.type('hello');

    await stub(app, first);
    await win.keyboard.press('Control+s');
    await expect.poll(() => (existsSync(first) ? readFileSync(first, 'utf8') : ''), { timeout: FILE_OP_TIMEOUT_MS }).toBe('hello');

    // Save As → choose a different location; the doc is written there too.
    await stub(app, second);
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await item(win, 'Save As…').click();
    await expect.poll(() => (existsSync(second) ? readFileSync(second, 'utf8') : ''), { timeout: FILE_OP_TIMEOUT_MS }).toBe('hello');
  } finally {
    cleanupTemp(root);
  }
});

test('the save dialog defaults the file name to the Panel name (FR-083)', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    const { app, win } = shared;
    await createProject(win, 'Fb2DefaultName', root);
    const pid = await newEditor(win);

    // Rename the panel to a known name.
    await win.getByTestId(`panel-handle-${pid}`).dblclick();
    const rename = win.getByTestId(`panel-rename-input-${pid}`);
    await rename.fill('MyDocument');
    await rename.press('Enter');

    // Capture the save-dialog default path.
    await app.evaluate(({ dialog }) => {
      (globalThis as Record<string, unknown>).__savePath = null;
      dialog.showSaveDialog = async (a: unknown, b: unknown) => {
        const opts = (b ?? a) as { defaultPath?: string };
        (globalThis as Record<string, unknown>).__savePath = opts?.defaultPath ?? '';
        return { canceled: true, filePath: undefined };
      };
    });

    await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
    await win.keyboard.type('x');
    await win.keyboard.press('Control+s');

    await expect
      .poll(async () => app.evaluate(() => (globalThis as Record<string, unknown>).__savePath), {
        timeout: 6000,
      })
      .toContain('MyDocument');
  } finally {
    cleanupTemp(root);
  }
});
