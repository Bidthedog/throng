/**
 * Regression E2E for issue 144 — the editor caret/selection is lost when you switch
 * away from an editor's tab and back.
 *
 * ## The mechanism
 *
 * A background tab is not in the React tree (FR-008), so switching tabs UNMOUNTS the
 * editor and `view.destroy()`s the CodeMirror view — which holds all selection/scroll
 * state. Remounting rebuilds the view from the authority's TEXT, which carries no
 * selection, so the caret snapped back to offset 0. The fix saves the view state
 * (selection + scroll) on unmount, keyed by panel id, and restores it on the next
 * mount (`editor-view-state.ts`, wired through `use-editor.ts`).
 *
 * This test moves the caret to the end of a known line, switches away (adds a second
 * tab), switches back, then types a marker WITHOUT re-clicking — so the marker lands
 * wherever the caret actually is. With the bug it lands at the start of the document;
 * fixed, it lands at the end of the line the user left it on.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, reloadWindow } from './harness.js';
import { skipIfElevated } from './admin.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-caret-'));
  // Four distinct single-word lines so the caret's line is unambiguous from the text.
  writeFileSync(join(root, 'lines.txt'), 'AAAA\nBBBB\nCCCC\nDDDD\n');
  return root;
}

async function newEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
}

/** The editor's lines as plain text (zero-width placeholder → empty line). */
const docLines = (win: Page, pid: string): Promise<string[]> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)].map((l) =>
        l.textContent === '​' ? '' : (l.textContent ?? ''),
      ),
    pid,
  );

test('the scroll position is restored and the editor re-focuses on switch back (issue 144)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-scroll-'));
  const rows = Array.from({ length: 200 }, (_, i) => `row-${String(i).padStart(3, '0')}`);
  // No trailing newline, so Ctrl+End lands at the end of "row-199", not an empty line after it.
  writeFileSync(join(root, 'long.txt'), rows.join('\n'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ScrollProj', root);
      const pid = await firstPanelId(win);
      await newEditor(win, pid);

      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('long.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('row-000', { timeout: 8000 });

      // Scroll to the very bottom (caret at end of the document).
      await content.click();
      await win.keyboard.press('Control+End');
      const scroller = win.getByTestId(`editor-${pid}`).locator('.cm-scroller');
      const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
      expect(scrollBefore).toBeGreaterThan(0);

      // Switch away (second tab) and back to the editor's tab (remount).
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').nth(0).click();
      await expect(content).toContainText('row-199', { timeout: 8000 });

      // The viewport is restored near the bottom, not reset to the top.
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 8000 })
        .toBeGreaterThan(scrollBefore - 40);

      // The editor took keyboard focus on remount WITHOUT a click (CodeMirror marks the
      // focused view with `.cm-focused`)…
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-editor')).toHaveClass(
        /cm-focused/,
        { timeout: 4000 },
      );
      // …so a typed marker lands at the restored caret (end of the document).
      await win.keyboard.type('Z');
      const lines = await docLines(win, pid);
      expect(lines.filter((l) => l.includes('Z')).join()).toContain('row-199Z');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

/** Click a project's switch button (by name) and wait for it to become the active project. */
async function switchToProject(win: Page, name: string): Promise<void> {
  await win.locator('.project-item', { hasText: name }).locator('.project-item__switch').click();
  await expect(win.locator('.project-item', { hasText: name })).toHaveClass(/project-item--active/);
}

test('the editor takes focus on switching to a project whose editor mounts fresh (issue 144)', async () => {
  skipIfElevated();
  // The remaining #144 defect: the mount-time focus is gated on saved SESSION view-state so a plain
  // file-open leaves the tree focusable (for F2-rename). But switching to a project whose active
  // editor has NOT been mounted this session — the common "reopen an existing project after a
  // restart" case — has no saved view-state either, so that gate declined to focus it. A deliberate
  // PROJECT switch must move the caret into the target editor; a tree file-open must not. The two
  // are told apart by whether the ACTIVE TAB changed, which is what the fix keys on.
  const rootA = makeProject(); // lines.txt: AAAA / BBBB / CCCC / DDDD
  const rootB = mkdtempSync(join(tmpdir(), 'throng-caret-b-'));
  writeFileSync(join(rootB, 'other.txt'), 'other\n');
  try {
    await runApp(async (_app, win) => {
      // ProjA with an editor showing lines.txt.
      await createProject(win, 'ProjA', rootA);
      const pidA = await firstPanelId(win);
      await newEditor(win, pidA);
      await win.getByTestId(`editor-${pidA}`).click();
      await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pidA}`).locator('.cm-content')).toContainText('CCCC', {
        timeout: 8000,
      });
      await createProject(win, 'ProjB', rootB);

      // Renderer restart wipes the session's saved editor view-state, and startup auto-opens NO
      // project — so opening ProjA below mounts its editor FRESH (no saved caret). That is precisely
      // the "reopen an existing project" case the earlier one-shot skipped (it only focused a panel
      // that had already been mounted-and-unmounted this session).
      await reloadWindow(win);
      await expect(win.getByTestId('workspace-no-project')).toBeVisible({ timeout: 8000 });

      // Open ProjA — its editor mounts fresh and must take keyboard focus WITHOUT a click.
      await switchToProject(win, 'ProjA');
      const content = win.getByTestId(`editor-${pidA}`).locator('.cm-content');
      await expect(content).toContainText('CCCC', { timeout: 8000 });
      await expect(win.getByTestId(`editor-${pidA}`).locator('.cm-editor')).toHaveClass(
        /cm-focused/,
        { timeout: 4000 },
      );
      // The keystroke routes into that editor (fresh mount → caret at document start).
      await win.keyboard.type('Z');
      const lines = await docLines(win, pidA);
      expect(lines[0]).toBe('ZAAAA');
    });
  } finally {
    rmSync(rootA, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    rmSync(rootB, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a terminal in the tab does NOT steal focus from the active editor on switch-back (issue 144)', async () => {
  skipIfElevated();
  // The user's exact report: if a tab contains a terminal, that terminal grabs keyboard focus on a
  // tab/project switch regardless of which panel is active — because a terminal `focus()`es itself
  // unconditionally on mount AND on its (late, async) attach. Here the ACTIVE panel is the editor, but
  // the tab also holds a terminal; on switch-back the editor must keep focus.
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MixProj', root);
      const editorPid = await firstPanelId(win);
      await newEditor(win, editorPid);
      await win.getByTestId(`editor-${editorPid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${editorPid}`).locator('.cm-content')).toContainText('CCCC', {
        timeout: 8000,
      });

      // Add a sibling terminal panel (so the tab is [editor, terminal]).
      await win.getByTestId(`panel-add-${editorPid}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const termPid = (await panelIds(win)).find((id) => id !== editorPid)!;
      // Commit the new panel's inline rename if it opened, so the type picker is reachable.
      await win.keyboard.press('Enter').catch(() => undefined);
      await win.getByTestId(`panel-type-select-${termPid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
      await win.getByTestId(`panel-type-confirm-${termPid}`).click();
      // Wait for the shell to be live (prompt shows the project root) so the attach focus has fired.
      await expect(win.getByTestId(`terminal-${termPid}`)).toContainText(basename(root), {
        timeout: 20000,
      });

      // Make the EDITOR the active panel, then switch tabs away and back.
      await win.getByTestId(`editor-${editorPid}`).click();
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').nth(0).click();

      // Both panels remount; wait for the terminal to re-attach (its late focus fires here) AND the
      // editor content to be back, THEN assert the EDITOR — the active panel — holds keyboard focus.
      await expect(win.getByTestId(`terminal-${termPid}`)).toContainText(basename(root), {
        timeout: 20000,
      });
      await expect(win.getByTestId(`editor-${editorPid}`).locator('.cm-content')).toContainText('CCCC', {
        timeout: 8000,
      });
      await expect(win.getByTestId(`editor-${editorPid}`).locator('.cm-editor')).toHaveClass(
        /cm-focused/,
        { timeout: 6000 },
      );
      // And the terminal is NOT the focused surface.
      const termFocused = await win
        .getByTestId(`terminal-${termPid}`)
        .locator('.xterm')
        .evaluate((el) => el.classList.contains('focus'));
      expect(termFocused).toBe(false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the caret survives a tab switch away and back (issue 144)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CaretProj', root);
      const pid = await firstPanelId(win);
      await newEditor(win, pid);

      // Open the file and put the caret at the END of the third line ("CCCC").
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('CCCC', { timeout: 8000 });
      await content.locator('.cm-line', { hasText: 'CCCC' }).click();
      await win.keyboard.press('End');

      // Switch AWAY: a second tab becomes active, so the editor's tab unmounts (saving
      // its view state), then switch BACK to the editor's tab (remount → restore).
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(2);
      await win.locator('.tab-chip').nth(0).click();
      await expect(content).toContainText('CCCC', { timeout: 8000 });

      // Focus the editor WITHOUT clicking (a click would move the caret). CodeMirror
      // reflects its restored state-selection to the DOM on focus, so the marker we
      // type lands at the caret the fix restored.
      await content.evaluate((el) => (el as HTMLElement).focus());
      await win.keyboard.type('Z');

      const lines = await docLines(win, pid);
      // Restored: the marker appends to the line the caret was left on…
      expect(lines[2]).toBe('CCCCZ');
      // …and the first line is untouched (it would read "ZAAAA" if the caret reset to 0).
      expect(lines[0]).toBe('AAAA');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
