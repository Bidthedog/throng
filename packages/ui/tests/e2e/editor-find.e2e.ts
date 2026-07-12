import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// 013 US1 — find in the active editor: seed from selection, incremental as-you-type
// highlighting, the current/total count, wrap, the match-mode toggles, the no-results
// state, and close. Throughout: the file's content is never altered by searching.

async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

async function typeInto(win: Page, pid: string, text: string): Promise<void> {
  await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
  await win.keyboard.type(text);
}

/** The editor's current text. CodeMirror renders spaces as non-breaking ones, so they
 *  are normalised back before asserting on the document's content. */
async function docText(win: Page, pid: string): Promise<string> {
  return win
    .getByTestId(`editor-${pid}`)
    .locator('.cm-content')
    .evaluate((el) =>
      (el as HTMLElement).innerText.split(String.fromCharCode(160)).join(' '),
    );
}

const matches = (win: Page, pid: string) =>
  win.getByTestId(`editor-${pid}`).locator('.throng-search-match');
const currentMatch = (win: Page, pid: string) =>
  win.getByTestId(`editor-${pid}`).locator('.throng-search-match--current');

test('finds as you type: highlights every match, marks the current one, counts them', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FindProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'alpha beta\nalpha gamma\nALPHA delta\n');

      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();

      await win.getByTestId('find-input').fill('alpha');

      // Case-insensitive by default ⇒ all three, highlighted incrementally.
      await expect(matches(win, pid)).toHaveCount(3);
      await expect(currentMatch(win, pid)).toHaveCount(1);
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');

      // Searching never edits the file (SC-001).
      expect(await docText(win, pid)).toContain('alpha beta');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('find next / previous step through matches and wrap at both ends', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'WrapProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'x one\nx two\nx three\n');

      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('x');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');

      await win.getByTestId('find-next').click();
      await expect(win.getByTestId('find-count')).toHaveText('2 of 3');
      await win.getByTestId('find-next').click();
      await expect(win.getByTestId('find-count')).toHaveText('3 of 3');
      // Wraps forward past the last match.
      await win.getByTestId('find-next').click();
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');
      // …and backward past the first.
      await win.getByTestId('find-previous').click();
      await expect(win.getByTestId('find-count')).toHaveText('3 of 3');

      // The file is untouched by all that stepping.
      expect(await docText(win, pid)).toContain('x three');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('match-case and whole-word toggles narrow the matches live (FR-007)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ModesProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'foo Foo food\n');

      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('foo');
      // foo, Foo, foo(d) — case-insensitive substring.
      await expect(win.getByTestId('find-count')).toHaveText('1 of 3');

      await win.getByTestId('find-match-case').click();
      // foo, foo(d) — 'Foo' drops out.
      await expect(win.getByTestId('find-count')).toHaveText('1 of 2');

      await win.getByTestId('find-whole-word').click();
      // only the standalone 'foo' survives.
      await expect(win.getByTestId('find-count')).toHaveText('1 of 1');
      await expect(matches(win, pid)).toHaveCount(1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seeds the term from the selection, and shows a no-results state for a miss', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SeedProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'needle in haystack\nneedle again\n');

      // Select the word under the caret (double-click), then open find.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').getByText('haystack').dblclick();
      await win.keyboard.press('Control+f');

      await expect(win.getByTestId('find-input')).toHaveValue('haystack');
      await expect(win.getByTestId('find-count')).toHaveText('1 of 1');

      // A term that misses reports no results and changes nothing.
      await win.getByTestId('find-input').fill('zzz-not-here');
      await expect(win.getByTestId('find-count')).toHaveText('No results');
      await expect(matches(win, pid)).toHaveCount(0);
      expect(await docText(win, pid)).toContain('needle in haystack');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('closing find clears the highlights and returns focus to the editor', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'CloseProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'close me\n');

      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('close');
      await expect(matches(win, pid)).toHaveCount(1);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId(`find-bar-${pid}`)).toHaveCount(0);
      await expect(matches(win, pid)).toHaveCount(0);

      // Focus is back in the content: typing goes into the document.
      await win.keyboard.type('!');
      expect(await docText(win, pid)).toContain('!');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renders results within the 1000 ms budget on a ~10k-line file (SC-007)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    // The SC-007 representative fixture: ~10k lines, 20 of them matching.
    const lines: string[] = [];
    for (let i = 0; i < 10000; i++) lines.push(i % 500 === 0 ? `needle line ${i}` : `line ${i}`);
    writeFileSync(join(root, 'big.txt'), lines.join('\n'), 'utf8');

    await runApp(async (_app, win) => {
      await createProject(win, 'PerfProj', root);
      const pid = await newEditor(win);
      await win.getByTestId(`editor-${pid}`).click();

      // Open it the way a user would, so the measurement is of the real editor.
      await win.getByTestId('file-explorer-tree').getByText('big.txt', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        'needle line 0',
        { timeout: 15000 },
      );

      // Clicking the tree made the Files pane active, and find is a PANEL command —
      // so put the workspace back in focus first (the same gate as Ctrl+S).
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();
      await win.keyboard.press('Control+f');
      const started = Date.now();
      await win.getByTestId('find-input').fill('needle');
      // All 20 matches must resolve. WHICH one is current depends on where the caret
      // sits (find starts from the caret), so only the total is pinned here.
      await expect(win.getByTestId('find-count')).toHaveText(/^\d+ of 20$/, { timeout: 5000 });
      const elapsed = Date.now() - started;

      // The debounce plus the search itself must land inside the SC-007 budget.
      expect(elapsed, `find took ${elapsed}ms on a 10k-line file`).toBeLessThan(1000);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('every find-bar action control is the same size, and match-case reads "Aa"', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ChromeProj', root);
      const pid = await newEditor(win);
      await typeInto(win, pid, 'sizing\n');

      await win.keyboard.press('Control+h'); // find WITH replace, so every control is up
      await expect(win.getByTestId(`find-bar-${pid}`)).toBeVisible();
      await expect(win.getByTestId('find-replace-row')).toBeVisible();

      // The toggles say what they match on.
      await expect(win.getByTestId('find-match-case')).toHaveText('Aa');
      await expect(win.getByTestId('find-whole-word')).toHaveText('ab');

      // The glyphs vary wildly in width (an emoji, arrows, two letters), so the BUTTONS
      // must be a fixed box — otherwise the bar's controls come out ragged.
      const ids = [
        'find-match-case',
        'find-whole-word',
        'find-previous',
        'find-next',
        'find-close',
        'replace-current',
        'replace-all',
      ];
      const boxes = await Promise.all(
        ids.map(async (id) => {
          const box = await win.getByTestId(id).boundingBox();
          return { id, w: Math.round(box?.width ?? -1), h: Math.round(box?.height ?? -1) };
        }),
      );
      const first = boxes[0]!;
      expect(first.w).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b, `${b.id} is not the same size as ${first.id}`).toEqual({
          id: b.id,
          w: first.w,
          h: first.h,
        });
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('find is a no-op when no panel is active (spec Edge Cases)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-find-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NoPanelProj', root);
      const pid = await firstPanelId(win);
      // An unconfigured panel has no type — nothing to search.
      await win.keyboard.press('Control+f');
      await expect(win.getByTestId(`find-bar-${pid}`)).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
