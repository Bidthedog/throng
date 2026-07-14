import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, panelIds, addPanels } from './harness.js';
import { skipIfElevated } from './admin.js';

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
  await expect(term).toContainText(basename(root), { timeout: 20000 });
}

test('with a TERMINAL active, none of the editor commands fire — and the chord reaches the shell', async () => {
  skipIfElevated();
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
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('with the FILE TREE focused, Tab does not indent the document', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ScopeProj', root);
      const [pid] = await panelIds(win);
      await openEditor(win, pid);

      // Clicking a file in the TREE opens it in the editor AND leaves the keyboard on the tree —
      // so the app now has a live editor holding a document, and the focus somewhere else.
      await win.getByTestId('file-explorer-tree').getByText('doc.txt', { exact: true }).click();
      await win.keyboard.press('Tab');
      await win.keyboard.press('Shift+Tab');

      expect(await docText(win, pid)).toBe(CONTENT);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('with the FIND BAR focused, Tab does not indent the document', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ScopeProj', root);
      const [pid] = await panelIds(win);
      await openEditor(win, pid);

      // The find bar lives INSIDE the editor panel, which is exactly what makes this dangerous: the
      // panel is the active one, the editor is scoped live, and a Tab pressed while the caret is in
      // the find INPUT would indent the document behind it — silently editing a file the user is
      // only searching.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId('find-input')).toBeFocused();

      await win.keyboard.press('Tab');
      await win.keyboard.press('Shift+Tab');

      expect(await docText(win, pid)).toBe(CONTENT);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
