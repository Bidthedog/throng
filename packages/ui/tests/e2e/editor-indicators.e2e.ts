import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp } from './harness.js';

// US8/US7 (Delivery C): the shared red unsaved dot aggregates on Panel/Tab/project and clears on
// save. Auto-save moved down a layer in 044 T218 — see the note at the foot of this file.

async function stubSaveDialog(app: ElectronApplication, picked: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, picked);
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

test('the unsaved dot lights on panel + tab + project and clears on save', { tag: ['@extended', '@editor'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-ind-'));
  const savePath = join(root, 'doc.txt');
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'IndProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.type('dirty content');

      /*
       * ── THE FOUR-DOT AGREEMENT MOVED (035 T055) ──
       *
       * That one dirty document lights the panel, the tab, the project row AND the tree row — and
       * that one save clears all four — is `packages/ui/tests/component/editor-dirty-store.test.ts`.
       * All four read `editor-state.ts`'s single `states` map through four selectors, so their
       * agreement is a property of that store and not of any window; the store had no test of its
       * own. That each of the four call sites RENDERS a dot from its selector is
       * `packages/ui/tests/unit/unsaved-dot-call-sites.test.ts`.
       *
       * What is left here is the half neither can reach: the SAVE. One dot is still asserted, as the
       * live witness that a real edit reaches the real store — the claim being about the round trip
       * below it, not about the dot.
       */
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toBeVisible();

      // Save → every dot clears.
      await stubSaveDialog(app, savePath);
      await win.keyboard.press('Control+s');
      await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0, { timeout: 8000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * ── `auto-save writes edits within the debounce without Ctrl+S` MOVED DOWN (044 T218, performing
 *    T181) ──
 *
 * It launched an Electron app with a seeded `THRONG_CONFIG_ROOT`, typed into a real CodeMirror and
 * polled a real file, to prove a claim that splits cleanly across two cheaper layers:
 *
 *   • the edit arms a save, the timer FIRES, and the renderer asks the authority to write in place
 *     with no key pressed — `packages/ui/tests/component/editor-update-listener.test.ts`, four new
 *     cases under `auto-save writes the edit without Ctrl+S (006 FR-060)`. That file already owned
 *     the arming half; what it lacked was any assertion that the armed timer did anything, so a
 *     callback that saved nothing was green at every layer. Two of the four are new coverage
 *     outright: the debounce (two edits, one save) and FR-060's unpathed clause (no write AND no
 *     unasked dialog).
 *   • the request reaches disk with the right bytes — `integration/editor-service-save.integration
 *     .test.ts`, which writes real files through the real `EditorService` and asserts encoding, BOM
 *     and line-ending preservation. Strictly more than `readFileSync(...).toContain('AUTO')`.
 *
 * Neither half needs a window, a daemon or a layout, which is the whole test for whether an E2E
 * earns its place. Both breaks are recorded in the component file's header: each new case is red
 * under exactly one of two deliberate breaks to `use-editor.ts`, and none under both.
 *
 * The declaration above — the unsaved dot and the SAVE — stays: a real Ctrl+S through a real
 * accelerator into a real window is not the same claim.
 */
