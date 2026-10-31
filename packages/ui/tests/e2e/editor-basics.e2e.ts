import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  FILE_OP_TIMEOUT_MS,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/*
 * ONE app for this file, not one per test (the pattern is `editor-open.e2e.ts`'s). Neither test seeds
 * state before launch, and each builds its own project, which swaps the whole workspace.
 *   runApp        runs against the shared window and REFUSES options rather than ignoring them.
 *   createProject appends a counter, so duplicate names never make `.project-item` ambiguous.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error('this file shares one app; a test needing launch options must call runOwnApp instead');
  }
  return fn(shared.app, shared.win);
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

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

test('creates an editor, types, saves within the tree, and shows type + file pills', { tag: ['@core', '@editor'] }, async () => {
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
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf8') : ''), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe('hello\nworld\n');
      // New-doc default line ending is LF (no CRLF on disk).
      expect(readFileSync(savePath).includes(0x0d)).toBe(false);
      // Saving clears the unsaved dot and shows the filename pill.
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-file-${pid}`)).toContainText('note.txt');
    });
  } finally {
    cleanupTemp(root);
  }
});

test('the File Explorer pane gates Ctrl+S (no-op) and highlights when active', { tag: ['@core', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-ed-'));
  const savePath = join(root, 'gated.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'EditProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'unsaved edits');

      // Click the File Explorer pane → it becomes the active pane (highlighted).
      await win.getByTestId('files-pane').click();
      await expect(win.getByTestId('files-pane')).toHaveAttribute('data-active-pane', 'true');
      // The highlight border is an overlay pseudo-element rendered ABOVE the tree
      // row selection box (FR-071) — assert the ::after border + its stacking.
      // 046 FR-073: the outline is as thin as the pane's own default border (`.pane--explorer`'s
      // border-left), read from the live pane rather than spelled, and never the workspace panels' 2px.
      const overlay = await win.getByTestId('files-pane').evaluate((el) => {
        const s = getComputedStyle(el, '::after');
        const pane = el.closest('.pane--explorer');
        return {
          border: s.borderTopWidth,
          paneBorder: pane ? getComputedStyle(pane).borderLeftWidth : null,
          z: s.zIndex,
          pe: s.pointerEvents,
        };
      });
      expect(overlay.paneBorder, 'files-pane is not inside .pane--explorer').not.toBeNull();
      expect(overlay.border).toBe(overlay.paneBorder);
      expect(Number(overlay.z)).toBeGreaterThan(0);
      expect(overlay.pe).toBe('none'); // never intercepts clicks on the tree

      // Ctrl+S is now a no-op — no save dialog runs, nothing is written.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');
      // sleep-justified: gated at the keybinding-scope layer, before it ever reaches the editor's
      // sleep-justified: save handler — so there is no event, notice or file write to observe. The
      // sleep-justified: absence itself is the claim, and only outrunning the clock can show it.
      await win.waitForTimeout(400);
      expect(existsSync(savePath)).toBe(false);
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * ── THREE DECLARATIONS DELETED (test-suite audit) ──
 *
 *   - `refuses an out-of-tree save and leaves the buffer unsaved` is a duplicate of the migrated
 *     proof: `integration/editor-service-save.integration.test.ts:70` (refused, nothing written
 *     outside) plus `component/editor-notices.test.ts` "a refused save says so" (visible notice,
 *     buffer left unsaved).
 *   - `warns (does not lock) when a dirty saved file changes on disk; Save-All writes the scope` is
 *     `integration/editor-external-change.integration.test.ts` ("a DIRTY editor gets a one-shot
 *     'changed on disk' notice, buffer untouched"), the notice's wording in
 *     `component/editor-notices.test.ts`, Save-All's scope in `core/tests/unit/save-scope.test.ts`
 *     and its write in `editor-coordinator-lifecycle.integration.test.ts` ("saveAll saves every dirty
 *     document").
 *   - `editor-indicators.e2e.ts` ("the unsaved dot lights ... and clears on save") was a strict
 *     subset of the first test above, which types, sees the dot, saves and sees it clear.
 */
