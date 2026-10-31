import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { TERMINAL_OUTPUT_TIMEOUT_MS, addPanels, cleanupTemp, createProject as newProject, openApp, panelIds, type AppOptions, type OpenApp } from './harness.js';

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


/**
 * The seven editor commands are EDITOR-scoped (016, FR-017b0/FR-017d · T096).
 *
 * This is the negative half of the scope story, and it is the half that decides whether throng is
 * safe to type in. An unscoped `Ctrl+X` reaching the File Explorer deletes a FILE when the user
 * meant a line; an unscoped `Tab` reaching a Terminal indents a document the user is not even
 * looking at; and a `Ctrl+X` that throng SWALLOWS in a terminal never reaches the shell, where it is
 * a real control character.
 *
 * The assertions are therefore all of the form "the document did not change" — because the failure
 * mode is a command firing somewhere it should not, and nothing else would show it.
 */

const CONTENT = 'alpha\nbeta\ngamma\n';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-scope-'));
  writeFileSync(join(root, 'doc.txt'), CONTENT);
  return root;
}

const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

/** An editor panel holding doc.txt. */
async function openEditor(win: Page, pid: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('doc.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('alpha', {
    timeout: 8000,
  });
}

/** A cmd.exe terminal in the given panel, settled on its first prompt. */
async function openTerminal(win: Page, pid: string, root: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });
}

test('with a TERMINAL active, none of the editor commands fire — and the chord reaches the shell', { tag: ['@extended', '@editor'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ScopeProj', root);
      await addPanels(win, 1);
      const [editorPanel, terminalPanel] = await panelIds(win);
      await openEditor(win, editorPanel);
      await openTerminal(win, terminalPanel, root);

      // Focus the TERMINAL, then press every editor chord in turn.
      await win.getByTestId(`terminal-${terminalPanel}`).click();
      await win.keyboard.press('Control+x'); // cut-line
      await win.keyboard.press('Tab'); // indent-lines
      await win.keyboard.press('Shift+Tab'); // outdent-lines
      await win.keyboard.press('Shift+Alt+ArrowDown'); // column-select-down
      await win.keyboard.press('Control+v'); // paste

      // The document is untouched. Not one of them fired — which is the whole point of a scope: the
      // editor is still open, still holds the document, and is simply not where the keyboard is.
      expect(await docText(win, editorPanel)).toBe(CONTENT);

      // …and throng did not SWALLOW the chords either (FR-017d). Ctrl+X is a control character to a
      // shell, and a terminal that has had its keystrokes eaten by the app is a broken terminal — so
      // the shell must still be listening. It is: it runs the next command it is given.
      await win.keyboard.type('echo STILL-ALIVE', { delay: 15 });
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`terminal-${terminalPanel}`)).toContainText('STILL-ALIVE', {
        timeout: 20000,
      });
    });
  } finally {
    cleanupTemp(root);
  }
});

/*
 * DELETED (test-suite audit) — `with the FILE TREE focused, Tab does not indent the document` and
 * `with the FIND BAR focused, Tab does not indent the document`. Both are decisions of the scope
 * resolver, which no window is needed to see: `unit/scope.test.ts` "is the EXPLORER scope whenever
 * the file tree holds the focus" and "a panel-scoped chord resolves only in the scope it belongs to"
 * (AS-9), and "the focus guard (FR-017f) / stops an editor command firing from inside the find bar —
 * Tab must not indent the file"; `core/tests/unit/keybindings-scope.test.ts:93` Tab resolves to
 * `editor.indentLines` over an editor and to nothing over a terminal. The terminal test above stays:
 * it is the real chord reaching a real shell.
 */
