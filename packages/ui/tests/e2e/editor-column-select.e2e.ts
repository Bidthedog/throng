import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, panelIds, addPanels } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * US6 — rectangular (column) selection (016, FR-025 · T077-T083).
 *
 * The keyboard half is what this file exists for. Alt+drag is CodeMirror's own gesture; the chords
 * are ours, and when they lose they lose SILENTLY — the caret still moves, so the editor looks like
 * it did what you asked. It took a probe to find that CodeMirror had been discarding the block on
 * every dispatch (`allowMultipleSelections` defaults to FALSE), which no assertion on the SELECTION
 * would have caught either, since the one surviving cursor is a perfectly valid selection.
 *
 * So every test below asserts on the DOCUMENT, or on the file on disk. A block is real only if the
 * text that lands in the buffer says so.
 */

const GRID = 'aaaa\nbbbb\ncccc\ndddd\n';
const TABBED = '\tAAAA\nB\n\tCCCC\n';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-column-'));
  writeFileSync(join(root, 'grid.txt'), GRID);
  writeFileSync(join(root, 'other.txt'), 'one\ntwo\nthree\n');
  // Indented with TABS — so a column paste into it must pad with tabs, not spaces (FR-025c1).
  writeFileSync(join(root, 'tabs.txt'), TABBED);
  writeFileSync(join(root, 'rows.txt'), 'r0\nr1\nr2\nr3\nr4\nr5\nr6\nr7\nr8\nr9\n');
  return root;
}

/** Turn `pid` into an Editor Panel, focus it, and open `name` from the tree into it. */
async function openInPanel(win: Page, pid: string, name: string, expectText: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(expectText, {
    timeout: 8000,
  });
}

async function openFileInEditor(win: Page, name: string, expectText: string): Promise<string> {
  const pid = await firstPanelId(win);
  await openInPanel(win, pid, name, expectText);
  return pid;
}

/** The editor's whole document, as the user sees it. */
const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

/**
 * What the clipboard holds, and how throng has marked it.
 *
 * `text` is the plain text an OTHER APPLICATION would receive — it is what main wrote to the OS
 * clipboard — so asserting on it is the outbound half of FR-025d, not merely throng talking to
 * itself.
 */
const clipboard = (win: Page): Promise<{ text: string; mode: string }> =>
  win.evaluate(() => window.throng!.clipboard!.paste() as Promise<{ text: string; mode: string }>);

/** Write the clipboard as an EXTERNAL application would: plain text, no rectangular marker. */
const writeExternal = (win: Page, text: string): Promise<void> =>
  win.evaluate((t) => window.throng!.clipboard!.write({ text: t, mode: 'verbatim' }), text);

/** The exact client coordinates of a character position — no font-metric guessing. */
const coordsAt = (
  win: Page,
  pid: string,
  line: number,
  col: number,
): Promise<{ x: number; y: number }> =>
  win.evaluate(
    ({ id, line: l, col: c }) => {
      const lines = document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`);
      const node = lines[l - 1].firstChild!;
      const range = document.createRange();
      range.setStart(node, c);
      range.setEnd(node, c);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y + r.height / 2 };
    },
    { id: pid, line, col },
  );

test('Shift+Alt+Arrow builds a real block — a typed character lands on EVERY row', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      const pid = await openFileInEditor(win, 'grid.txt', 'aaaa');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');

      // Three zero-width cursors, stacked in column 0. Typing must replace every row — not one.
      await win.keyboard.type('X');

      await expect.poll(() => docText(win, pid)).toBe('Xaaaa\nXbbbb\nXcccc\ndddd\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Alt+drag makes a block, and cutting it takes ONLY the block’s characters (FR-025e)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      const pid = await openFileInEditor(win, 'grid.txt', 'aaaa');

      const from = await coordsAt(win, pid, 1, 1);
      const to = await coordsAt(win, pid, 3, 3);
      await win.keyboard.down('Alt');
      await win.mouse.move(from.x, from.y);
      await win.mouse.down();
      await win.mouse.move(to.x, to.y, { steps: 8 });
      await win.mouse.up();
      await win.keyboard.up('Alt');

      await win.keyboard.press('Control+x');

      // Each line closes up HORIZONTALLY, keeping everything outside the block's columns. A cut that
      // fell through to the whole-line path would have destroyed the 'a'/'b'/'c' either side of it —
      // text the user drew a block precisely to avoid.
      await expect.poll(() => docText(win, pid)).toBe('aa\nbb\ncc\ndddd\n');

      const entry = await clipboard(win);
      expect(entry.mode).toBe('rectangular');
      expect(entry.text).toBe('aa\nbb\ncc');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Delete on a block clears it per row and NEVER touches the clipboard (FR-025g)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      const pid = await openFileInEditor(win, 'grid.txt', 'aaaa');
      await writeExternal(win, 'SENTINEL');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');

      // A ZERO-WIDTH block. Delete is not a no-op on it: it removes one character to the right of
      // every caret (FR-025g).
      await win.keyboard.press('Delete');
      await expect.poll(() => docText(win, pid)).toBe('aaa\nbbb\nccc\ndddd\n');

      // …and the clipboard still holds what the user last copied. A delete is not a cut, and
      // silently overwriting the clipboard would lose text they were about to paste.
      expect((await clipboard(win)).text).toBe('SENTINEL');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a block copied in one panel pastes COLUMN-WISE in another — the mode is app-global', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      await addPanels(win, 1);
      const [p1, p2] = await panelIds(win);
      await openInPanel(win, p2, 'other.txt', 'one');
      await openInPanel(win, p1, 'grid.txt', 'aaaa');

      // A block of the first two columns, three rows deep — then a NATIVE Ctrl+C.
      await win.getByTestId(`editor-${p1}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+c');

      // OUTBOUND (FR-025d/US6 AS5): what ANOTHER APPLICATION receives is the rows as plain text,
      // separated by line breaks. Ctrl+C is not a registered command in throng, so without a native
      // clipboard handler this would have gone straight to the OS behind main's back — leaving the
      // mode unmarked and the paste below verbatim.
      await expect.poll(async () => (await clipboard(win)).text).toBe('aa\nbb\ncc');
      expect((await clipboard(win)).mode).toBe('rectangular');

      // …and the block pastes as a BLOCK in a different panel, holding a different document.
      await win.getByTestId(`editor-${p2}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Control+v');

      await expect.poll(() => docText(win, p2)).toBe('aaone\nbbtwo\nccthree\n');
      // The source document is untouched by a COPY.
      expect(await docText(win, p1)).toBe(GRID);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('N EXTERNAL lines over an N-row block distribute one line per row (FR-025h)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      const pid = await openFileInEditor(win, 'grid.txt', 'aaaa');

      // Text from another application: plain, verbatim, carrying no rectangular signal. Three lines
      // over a three-row block is the ONLY route by which external column data enters a block.
      await writeExternal(win, '1\n2\n3');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+v');

      await expect.poll(() => docText(win, pid)).toBe('1aaa\n2bbb\n3ccc\ndddd\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a column paste into a TAB-indented file pads with TABS, and lands on the column (FR-025c1)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      await addPanels(win, 1);
      const [p1, p2] = await panelIds(win);
      await openInPanel(win, p2, 'tabs.txt', 'AAAA');
      await openInPanel(win, p1, 'grid.txt', 'aaaa');

      // Cut a one-column, three-row block out of the SPACE-indented file…
      await win.getByTestId(`editor-${p1}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+x');
      await expect.poll(async () => (await clipboard(win)).text).toBe('a\nb\nc');

      // …and paste it into the TAB-indented one at visual column 6. Line 2 is the short one ("B"),
      // so it must be padded out to reach column 6 — in the document's OWN whitespace.
      await win.getByTestId(`editor-${p2}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      for (let i = 0; i < 3; i += 1) await win.keyboard.press('ArrowRight'); // …visual column 6
      await win.keyboard.press('Control+v');
      await win.keyboard.press('Control+s');

      // Assert on the BYTES, not the screen: this requirement is about what lands on disk. A tab
      // carries column 1 → 4, then two spaces land exactly on column 6 — a second tab would have
      // jumped to column 8 and put the text where the user never pointed.
      await expect
        .poll(() => readFileSync(join(root, 'tabs.txt'), 'utf8'), { timeout: 8000 })
        .toBe('\tAAaAA\nB\t  b\n\tCCcCC\n');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('ONE Undo reverts a ten-row column paste — a command is one undo entry (FR-026)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Column', root);
      const pid = await openFileInEditor(win, 'rows.txt', 'r0');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      for (let i = 0; i < 9; i += 1) await win.keyboard.press('Shift+Alt+ArrowDown');
      await win.keyboard.press('Shift+Alt+ArrowRight');
      await win.keyboard.press('Control+x');

      const cut = '0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n';
      await expect.poll(() => docText(win, pid)).toBe(cut);

      // Paste all ten rows back, column-wise…
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Control+v');
      await expect.poll(() => docText(win, pid)).toBe('r0\nr1\nr2\nr3\nr4\nr5\nr6\nr7\nr8\nr9\n');

      // …and ONE Ctrl+Z takes all ten away again. Ten edits, one command, one entry.
      await win.keyboard.press('Control+z');
      await expect.poll(() => docText(win, pid)).toBe(cut);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
