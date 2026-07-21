/**
 * Regression E2E for issue #145 — destroying an editor's TAB leaves the file marked
 * open, so it can never be reopened in another editor without restarting the daemon.
 *
 * ## The mechanism this test pins
 *
 * The app-wide one-buffer registry (`packages/core/src/editor/open-registry.ts`) records
 * every open document by path → owning `{ panelId, windowId }`. A second open of an
 * already-open path is answered with `{ action: 'focus' }` and routed to the existing
 * editor instead of opening a new one.
 *
 * A PANEL destroy releases the registry entry: `panel-placeholder.tsx` calls
 * `disposeEditor(panelId)` → `throng:editor:destroy` IPC → `unregisterPanel`. But a TAB
 * destroy funnels through `ws.closeTab`, a pure `@throng/core` layout mutation that never
 * tears down the editor documents inside the tab. So the coordinator's doc and its
 * registry entry outlive the destroyed panel: the next open of that file is refused with
 * `focus` pointing at a panel that no longer exists, and silently no-ops. Only a daemon
 * restart (which wipes the in-memory registry) clears it.
 *
 * RED until the tab-close handlers dispose the editor documents they destroy, exactly as
 * the panel-destroy path does.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

/** A project with a single file at its root. */
function makeProject(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `throng-tabdestroy-${tag}-`));
  writeFileSync(join(root, 'note.txt'), 'REOPEN-ME-BODY\n');
  return root;
}

const rmRoot = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
};

/** Turn the panel `pid` into an editor. */
async function newEditor(win: Page, pid: string): Promise<string> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/** Open `name` from the tree into the editor `pid`, and settle on its content. */
async function openInto(win: Page, pid: string, name: string, body: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).click(); // make it the last-active editor
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(body, {
    timeout: 8000,
  });
}

/** The one-buffer registry's answer for a path: focus an existing editor, or open a new one? */
function openDecision(win: Page, absPath: string): Promise<string> {
  return win.evaluate(
    async (p) => (await window.throng.editor.openInto({ absPath: p })).action,
    absPath,
  );
}

/** Right-click the tab chip at `index` and destroy it, accepting every confirmation. */
async function destroyTab(win: Page, index: number): Promise<void> {
  const chip = win.locator('.tab-chip').nth(index);
  await chip.click({ button: 'right' });
  await win.getByTestId('menu-item-Destroy Tab').click();
  // The tab-destroy plan may raise one or two confirmation dialogs depending on the
  // configured level; accept each until the dialog is gone.
  const dialog = win.getByTestId('confirm-dialog');
  for (let i = 0; i < 3 && (await dialog.count()) > 0; i++) {
    await win.getByTestId('confirm-accept').click();
    await expect(async () => expect(await dialog.count()).toBe(0)).toPass({ timeout: 2000 }).catch(() => {});
  }
}

test('AC1 — destroying the tab that hosts an editor releases the one-buffer registry', async () => {
  skipIfElevated();
  const root = makeProject('ac1');
  const filePath = join(root, 'note.txt');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TabDestroy1', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'REOPEN-ME-BODY');
      // The registry knows the file is open — a second open would focus this editor.
      expect(await openDecision(win, filePath)).toBe('focus');

      // A second tab so tab 1 (the editor's tab) can be destroyed — closeTab keeps the
      // workspace non-empty, so the last tab cannot be closed. Adds and switches to it.
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);

      // Destroy tab 1, which hosts the editor.
      await destroyTab(win, 0);
      await expect(win.locator('.tab-chip')).toHaveCount(1);

      // The document is gone with its panel, so the file is no longer claimed by anyone:
      // a fresh open must open a NEW editor, not focus the destroyed one.
      await expect
        .poll(() => openDecision(win, filePath), { timeout: 8000 })
        .toBe('open');
    });
  } finally {
    rmRoot(root);
  }
});

test('AC2 — after the tab is destroyed the file opens again in a new editor', async () => {
  skipIfElevated();
  const root = makeProject('ac2');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'TabDestroy2', root);
      const pid = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid, 'note.txt', 'REOPEN-ME-BODY');

      // Second tab, then destroy the editor's tab.
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await destroyTab(win, 0);
      await expect(win.locator('.tab-chip')).toHaveCount(1);

      // In the surviving tab, make a new editor and open the same file. With the bug the
      // stale "focus" claim routes the open to the dead panel and this editor stays empty.
      const pid2 = await newEditor(win, await firstPanelId(win));
      await openInto(win, pid2, 'note.txt', 'REOPEN-ME-BODY');
      await expect(win.getByTestId(`editor-${pid2}`).locator('.cm-content')).toContainText(
        'REOPEN-ME-BODY',
      );
    });
  } finally {
    rmRoot(root);
  }
});
