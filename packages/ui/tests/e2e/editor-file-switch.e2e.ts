import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * Opening a SECOND file into the same panel (016, FR-002a/FR-018a).
 *
 * Every other editor test opens ONE file into a fresh panel. That is not how the app is used: a
 * user clicks through the tree, and each click REPLACES the document in the panel they are looking
 * at. That path has its own hazards, and both of the ones below shipped:
 *
 *   • Opening a file fires `refreshLanguage()` TWICE — once from the authority's reset broadcast
 *     (at which point the panel's recorded path is still the PREVIOUS file's) and once from
 *     `openFile` after the path updates. Both end in an `await import()` of a grammar chunk, and
 *     whichever resolves LAST wins. A cold chunk beats a warm one, so the result depends on which
 *     file you happened to open before — and the losing case mounts the WRONG language's grammar,
 *     which still highlights numbers and strings and so looks like "partial" highlighting rather
 *     than a bug.
 *
 *   • The same race decides the indentation, because the language chooses the profile the file's
 *     own style is layered onto.
 *
 * So these tests always open a file, THEN another, and assert on the second.
 */

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-switch-'));
  // Deliberately named so that a plain alphabetical tree lists them in this order. The reported
  // symptom depended on whether the previously-opened file sorted BEFORE or AFTER the target.
  writeFileSync(join(root, 'a-first.ts'), 'export const value: number = 42;\nexport const name = "x";\n');
  writeFileSync(join(root, 'b-query.sql'), 'SELECT id, name\nFROM items\nWHERE quantity < 5;\n');
  writeFileSync(join(root, 'c-third.py'), 'def main():\n    return 42\n');
  // Tab-indented, in a language whose profile is SPACES — so the FILE must win (FR-018a).
  writeFileSync(join(root, 'd-tabs.ts'), 'function a() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n');
  // Space-indented, in a language (Go) whose profile is TABS — so the FILE must win here too.
  writeFileSync(join(root, 'e-spaces.go'), 'package main\n\nfunc main() {\n  if x {\n    return\n  }\n}\n');
  return root;
}

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  return pid;
}

/** Click a file in the tree and wait for its content to land in the panel. */
async function open(win: Page, pid: string, name: string, contains: string): Promise<void> {
  await win.getByTestId('file-explorer-tree').getByText(name, { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(contains, {
    timeout: 8000,
  });
}

const docText = (win: Page, pid: string): Promise<string> =>
  win.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line`)]
        .map((l) => (l.textContent === '​' ? '' : l.textContent))
        .join('\n'),
    pid,
  );

/**
 * The colour the active theme paints a given syntax token with.
 *
 * Resolved from the live CSS variable rather than hard-coded, so this says "SELECT is painted as a
 * KEYWORD" and not "SELECT is #ff0000" — it holds on every theme.
 */
const tokenColour = (win: Page, token: string): Promise<string> =>
  win.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--throng-colour-${name})`;
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

/** The colour the editor has actually painted `word` in. */
const colourOfWord = (win: Page, pid: string, word: string): Promise<string | null> =>
  win.evaluate(
    ({ id, w }) => {
      const spans = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`)];
      const hit = spans.find((el) => el.textContent?.trim() === w);
      return hit ? getComputedStyle(hit).color : null;
    },
    { id: pid, w: word },
  );

test('a .sql opened AFTER another file gets the SQL grammar — not the previous file’s', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newEditor(win);

      // Open the file that sorts DIRECTLY BEFORE the target — the reported failing order.
      await open(win, pid, 'a-first.ts', 'export const value');
      // …then the target.
      await open(win, pid, 'b-query.sql', 'SELECT id');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('SQL', { timeout: 8000 });

      // The discriminator. Under the TypeScript grammar, `SELECT` is an ordinary identifier and
      // `FROM` is nothing at all — numbers and strings would still be coloured, which is exactly why
      // the bug read as "partially highlighted" rather than "wrong".
      const keyword = await tokenColour(win, 'syntaxKeyword');
      await expect.poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 }).toBe(keyword);
      expect(await colourOfWord(win, pid, 'FROM')).toBe(keyword);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('…and it does not matter which file was open before it', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newEditor(win);
      const keyword = await tokenColour(win, 'syntaxKeyword');

      // The file AFTER it in the listing (the order the user found working)…
      await open(win, pid, 'c-third.py', 'def main');
      await open(win, pid, 'b-query.sql', 'SELECT id');
      await expect.poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 }).toBe(keyword);

      // …and back and forth several times. The winner must never be decided by chunk-cache warmth.
      for (const [name, needle] of [
        ['a-first.ts', 'export const value'],
        ['b-query.sql', 'SELECT id'],
        ['c-third.py', 'def main'],
        ['b-query.sql', 'SELECT id'],
      ] as const) {
        await open(win, pid, name, needle);
      }
      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('SQL');
      await expect.poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 }).toBe(keyword);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a PLAIN-TEXT file opened after a highlighted one is left plain', async () => {
  skipIfElevated();
  const root = makeProject();
  writeFileSync(join(root, 'notes'), 'SELECT this is not code\nfunction neither is this\n');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newEditor(win);

      await open(win, pid, 'b-query.sql', 'SELECT id');
      await open(win, pid, 'notes', 'this is not code');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Plain Text');

      // The previous file's grammar must not still be mounted: nothing here is a keyword, because
      // there is no grammar at all.
      await expect
        .poll(() => colourOfWord(win, pid, 'SELECT'), { timeout: 8000 })
        .toBeNull();
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('the FILE’s indentation wins when it is the SECOND file opened into the panel (FR-018a)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newEditor(win);

      // Open a SPACE-indented file first, so anything stale is "spaces"…
      await open(win, pid, 'a-first.ts', 'export const value');
      // …then a TAB-indented one. TypeScript's profile is spaces and so is the global default, so
      // only the file's own style can produce a tab here.
      await open(win, pid, 'd-tabs.ts', 'function a()');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Tab');

      const text = await docText(win, pid);
      expect(text.startsWith('\t')).toBe(true);
      expect(text.startsWith('  ')).toBe(false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('…and the reverse: a SPACE-indented file opened after a tab-indented one indents with spaces', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newEditor(win);

      await open(win, pid, 'd-tabs.ts', 'function a()');
      // Go's language profile is TABS — so only the file's own 2-space style can produce spaces.
      await open(win, pid, 'e-spaces.go', 'package main');

      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+Home');
      await win.keyboard.press('Tab');

      const text = await docText(win, pid);
      expect(text.startsWith('\t')).toBe(false);
      expect(text.startsWith(' ')).toBe(true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('MARKDOWN is highlighted — headings, emphasis, links and inline code (FR-006)', async () => {
  skipIfElevated();
  const root = makeProject();
  writeFileSync(
    join(root, 'f-notes.md'),
    '# A heading\n\nSome **bold** and *italic* prose.\n\nA [link](https://example.com) and `inline code`.\n\n- a list item\n\n> a quotation\n',
  );
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SwitchProj', root);
      const pid = await newEditor(win);
      await open(win, pid, 'f-notes.md', 'A heading');

      await expect(win.getByTestId(`editor-language-${pid}`)).toHaveText('Markdown');

      /**
       * The grammar was loading correctly all along — but the highlight style mapped only CODE tags
       * (keyword, string, number, type, function…), and markdown emits PROSE tags: heading, strong,
       * emphasis, link, monospace, quote, list. None of them matched anything, so a markdown file was
       * parsed, tokenised, and then painted entirely in the default text colour.
       *
       * So this asserts on the number of DISTINCT colours actually on screen, which is the only
       * thing that would have caught it: the document is not one flat colour.
       */
      // POLLED: the grammar arrives as a lazily-imported chunk, so a query fired the instant the
      // text lands races it and reads zero spans on a perfectly healthy editor.
      const distinctColours = (): Promise<number> =>
        win.evaluate((id) => {
          const spans = [
            ...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`),
          ];
          return new Set(spans.map((s) => getComputedStyle(s).color)).size;
        }, pid);

      await expect.poll(distinctColours, { timeout: 8000 }).toBeGreaterThan(2);

      // …and a heading is painted as a keyword, which is the token the style maps it to.
      const keyword = await tokenColour(win, 'syntaxKeyword');
      await expect.poll(() => colourOfWord(win, pid, 'A heading'), { timeout: 8000 }).toBe(keyword);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
