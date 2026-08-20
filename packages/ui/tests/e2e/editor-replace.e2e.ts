import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  type AppOptions,
  type OpenApp, FILE_OP_TIMEOUT_MS } from './harness.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
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
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

// 013 US4 — replace in the active editor. The two properties that matter beyond "the text
// changed": replace-all is ONE undoable step (FR-008), and the file's encoding and line
// endings survive it untouched (SC-004) — a replace must not silently rewrite the file's
// shape, which is exactly what a naive read-modify-write would do.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/** Open a file from the tree, then put focus back in the editor (find is a panel command). */
async function openFile(win: Page, pid: string, name: string, expectText: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(expectText, {
    timeout: 15000,
  });
  await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
}

/*
 * ── TWO MOVED (035 T055) ──
 *
 * `packages/ui/tests/component/editor-search-controller.test.ts`:
 *
 *   :128  replace-current changes only the current match and advances to the next
 *   :157  editing the document while find is open does not misplace a later replace
 *
 * The second is the one worth the words. `replaceCurrent` calls `resync()` before it reads an
 * offset, because a user who edits above the match while the bar is open has moved every remembered
 * position — and a replace against a stale offset writes into whatever now occupies it, silently and
 * mid-word. Deleting that `resync()` reddens exactly one test.
 *
 * It nearly reddened none. The component harness originally re-ran the query on every edit, on the
 * reasoning that a real view's `updateListener` does, and with that in place the mutation passed
 * 17/17: the harness had done the production code's job. The harness now dispatches the edit and
 * nothing else, which is the condition the rule actually has to hold under.
 *
 * ── WHAT STAYS ──
 *
 * `:80` — replace-all over a CRLF file, asserting the BYTES on disk afterwards. One transaction is
 * proven below; that the file comes back with its line endings intact is the save path, and it is
 * the only claim here that reaches the filesystem.
 */
test('replace-all rewrites every match in one undoable step, preserving CRLF (SC-004)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-repl-'));
  const file = join(root, 'crlf.txt');
  try {
    // A CRLF file — the shape the replace must not disturb.
    writeFileSync(file, 'alpha one\r\nalpha two\r\nbeta three\r\n', 'utf8');

    await runApp(async (_app, win) => {
      await createProject(win, 'ReplProj', root);
      const pid = await newEditor(win);
      await openFile(win, pid, 'crlf.txt', 'alpha one');

      // Ctrl+H opens find WITH the replace controls (editor only).
      await win.keyboard.press('Control+h');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-replace-row')).toBeVisible();

      await win.getByTestId('find-input').fill('alpha');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 2');
      await win.getByTestId('replace-input').fill('OMEGA');

      // Replace every match at once; the count empties out.
      await win.getByTestId('replace-all').click();
      await expect(win.getByTestId('find-count')).toHaveText('No results');

      await win.keyboard.press('Escape');
      await win.keyboard.press('Control+s');

      // Only the intended text changed — and the file is still CRLF, still UTF-8.
      await expect
        .poll(() => readFileSync(file, 'utf8'), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe('OMEGA one\r\nOMEGA two\r\nbeta three\r\n');
      const bytes = readFileSync(file);
      expect(bytes.includes(0x0d), 'CRLF line endings were rewritten').toBe(true);

      // ONE undo puts the whole replace-all back (FR-008): not two, not three.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+z');
      await win.keyboard.press('Control+s');
      await expect
        .poll(() => readFileSync(file, 'utf8'), { timeout: FILE_OP_TIMEOUT_MS })
        .toBe('alpha one\r\nalpha two\r\nbeta three\r\n');
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * MOVED to `packages/ui/tests/component/find-bar-panel-kind.test.ts` (034 FR-045) — one test,
 * four component tests in its place.
 *
 * It created a project on a real temp folder and spawned a real `cmd.exe` in order to press two
 * chords and count two absent elements. Nothing it asserted came from the shell: no output was
 * searched, no scrollback read, and the bar never received a term. The chain it exercised is four
 * renderer guards, and all four mount here — including the wiring hop
 * (`search-keybindings.tsx:106`) that turns the active panel’s `kind` into the store’s
 * `FindPanelKind`, which is why `SearchKeybindings` is mounted rather than the store driven
 * directly.
 *
 * THE REPLACEMENT MAKES A DISTINCTION THIS TEST COULD NOT. Pressing Ctrl+H and then Ctrl+F and
 * reading the END STATE cannot tell "the replace chord was refused" (`:123`) from "the chord
 * opened a bar whose row was suppressed" (`search-store.ts:105`) — the two are identical from
 * outside. The component version asserts the first chord opens NOTHING, and separately that the
 * store refuses `{ replace: true }` for a terminal even when asked directly.
 *
 * AND IT IS FENCED AGAINST VACUITY: every terminal assertion is an absence, which a `FindBar`
 * rendering nothing satisfies perfectly. The editor case is asserted in the same file, so that
 * world fails.
 *
 * WHAT STAYS, AND WHY: the other three tests here. Two assert the BYTES on disk after a save
 * (replace-all preserving CRLF through the undo authority; replace-current advancing), and the
 * third rebases matches across a live document edit.
 *
 * ANTI-VACUITY CONTROL for the replacement file: drop the `WorkspaceProvider` element from its
 * `mount()`. `SearchKeybindings` calls `useWorkspace()`, which throws, so ALL FOUR fail.
 */
