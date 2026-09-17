/**
 * 044 FR-105 — in an editor, a REAL Alt+Left goes Back, and CodeMirror's own move-by-syntax on the same
 * keys never runs (research R22).
 *
 * ══ WHY THIS IS AN E2E (`@reserve:input`) ══
 *
 * CodeMirror binds Alt+ArrowLeft to `cursorSyntaxLeft` on its content element. The app's claim on the
 * chord is a capture-phase listener on the WINDOW that stops the event before it reaches that element
 * (`app.tsx`, `WINDOW_HANDLED_ACTIONS`). `component/window-arrow-chords.test.ts` presses a synthesised event
 * through that listener; what it cannot say is how a real keystroke is dispatched by the engine to a
 * focused, editable CodeMirror — which listener sees it first, and whether the editor still acts on it.
 * A synthesised event asserts the shape the test chose, not the engine's dispatch order.
 *
 * ══ HOW "THE CARET DID NOT MOVE" IS OBSERVED WITHOUT A RACE ══
 *
 * Back is a round trip through main, while `cursorSyntaxLeft` would move the caret synchronously on
 * the keydown. Read the caret after a clean Back and the answer depends on which finished first. So the
 * editor is made DIRTY first: Back then raises the unsaved-open prompt (FR-106a) and the editor holds
 * still under a modal, where its caret — the status bar's line and column readouts — can be read at
 * leisure. Precedence is decided at keydown, before the dirty check, so this is the same dispatch a
 * clean editor gets; *Discard & open* then completes the step, and `a.ts` is shown.
 *
 * The caret is placed INSIDE an identifier with a character typed there, so a syntax move would land
 * somewhere measurably different (the identifier's start), and the document text is checked too — a
 * selection-extending variant would change neither readout but would change what Discard discards.
 *
 * ══ TIER ══
 *
 * Keys into a focused editor and a modal dialog: `parallel-plan.json`'s serial tier, as FOCUS.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp, createProject, firstPanelId, focusEditor, cleanupTemp, type OpenApp } from './harness.js';

const A = 'export const alphaValue = computeAlpha(1);\n';
const B = 'export const betaValue = computeBeta(2);\n';

let shared: OpenApp;
let projectSeq = 0;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

test('a real Alt+Left in an editor goes Back to the previous file and does not move the caret by syntax (FR-105)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const { win } = shared;
  const root = mkdtempSync(join(tmpdir(), 'throng-history-keys-'));
  writeFileSync(join(root, 'a.ts'), A);
  writeFileSync(join(root, 'b.ts'), B);
  try {
    // Unique per run: a shared app accumulates projects, and `--repeat-each` reuses it.
    await createProject(win, `HistoryKeys-${(projectSeq += 1)}`, root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    const editor = win.getByTestId(`editor-${pid}`);
    await expect(editor).toBeVisible();
    const content = editor.locator('.cm-content');
    const tree = win.getByTestId('file-explorer-tree');

    // The editor shows a.ts, then b.ts: one entry to go Back to.
    await tree.getByText('a.ts', { exact: true }).click();
    await expect(content).toContainText('computeAlpha', { timeout: 8000 });
    await tree.getByText('b.ts', { exact: true }).click();
    await expect(content).toContainText('computeBeta', { timeout: 8000 });
    await expect(win.getByTestId(`panel-back-${pid}`)).toBeEnabled();

    // The caret inside `computeBeta`, with a character typed there: `compZ|uteBeta`.
    await focusEditor(win, pid);
    await win.keyboard.press('Control+Home');
    const inside = B.indexOf('computeBeta') + 'comp'.length;
    for (let i = 0; i < inside; i += 1) await win.keyboard.press('ArrowRight');
    await win.keyboard.type('Z');
    await expect(content).toContainText('compZuteBeta');
    const line = win.getByTestId(`editor-status-line-${pid}`);
    const column = win.getByTestId(`editor-status-column-${pid}`);
    await expect(column).toBeVisible();
    const caretBefore = { line: await line.textContent(), column: await column.textContent() };

    // The real chord.
    await win.keyboard.press('Alt+ArrowLeft');

    // Back ran: the dirty editor asks before leaving b.ts…
    await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible();
    // …and CodeMirror did not ALSO act on the keys: the caret is where it was, the text unchanged.
    expect({ line: await line.textContent(), column: await column.textContent() }).toEqual(caretBefore);
    await expect(content).toContainText('export const betaValue = compZuteBeta(2);');

    // Complete the step: a.ts is shown.
    await win.getByTestId('unsaved-open-discard').click();
    await expect(content).toContainText('computeAlpha', { timeout: 8000 });
    await expect(content).not.toContainText('computeBeta');
    await expect(win.getByTestId(`panel-forward-${pid}`)).toBeEnabled();
  } finally {
    cleanupTemp(root);
  }
});
