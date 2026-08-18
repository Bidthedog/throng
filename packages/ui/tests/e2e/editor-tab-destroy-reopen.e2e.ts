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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/** A project with a single file at its root. */
function makeProject(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `throng-tabdestroy-${tag}-`));
  writeFileSync(join(root, 'note.txt'), 'REOPEN-ME-BODY\n');
  return root;
}


const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch. Two temp roots, two project names (`TabDestroy1`,
 * `TabDestroy2`). Both files are called note.txt, which is safe because the one-buffer registry is
 * keyed by ABSOLUTE path (`packages/core/src/editor/open-registry.ts`) and the two roots differ —
 * checked, because "different project" is not the same claim as "different key".
 *
 * The roots are deleted in `afterAll`, NOT per test: under one app a per-test cleanup removes a
 * folder the application is still watching. Test 1 leaves its project on one tab; test 2's
 * `.tab-chip` counts are scoped to its own project's workspace, so they do not see it.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed option does not fail,
 * it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one daemon, so a failure SKIPS the rest rather than
 * running them against what it left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) cleanupTemp(dir);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
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

test('AC1 — destroying the tab that hosts an editor releases the one-buffer registry', { tag: ['@extended', '@editor'] }, async () => {
  const root = own(makeProject('ac1'));
  const filePath = join(root, 'note.txt');
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
});

test('AC2 — after the tab is destroyed the file opens again in a new editor', { tag: ['@extended', '@editor'] }, async () => {
  const root = own(makeProject('ac2'));
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
});
