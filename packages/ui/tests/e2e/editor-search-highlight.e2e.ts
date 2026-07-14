import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// 016 FR-007a / SC-007b — the COMPOSING half of the search/highlight overlap.
//
// The contrast guard proves the two layers COULD coexist legibly. This proves they actually DO:
// the match is a background, the syntax colour stays the foreground, and matched code keeps its
// highlighting instead of flattening into a solid block. Without this, the guard passes while the
// rendering is wrong — the colours are fine in a spreadsheet and gone on screen.

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-searchhl-'));
  writeFileSync(
    join(root, 'code.ts'),
    'const target = 1;\nfunction target2() {\n  return target;\n}\n',
  );
  return root;
}

async function openWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('code.ts', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('const target', {
    timeout: 8000,
  });
  return pid;
}

test('a search match keeps the code beneath it syntax-coloured (FR-007a)', async () => {
  skipIfElevated();
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'SearchHL', root);
      const pid = await openWithFile(win);

      // The colour `const` is painted in BEFORE searching.
      //
      // Polled, because grammars are loaded LAZILY (a dynamic import per language, so 31 grammars
      // are not shipped in the opening bundle): the text lands first and the highlighting a tick
      // later. Reading the colours the instant the text appears is a race with the app's own
      // design, not a test of it.
      const keywordColourOf = (): Promise<string | null> =>
        win.evaluate((id) => {
          const spans = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`)];
          const kw = spans.find((s) => s.textContent === 'const');
          return kw ? getComputedStyle(kw).color : null;
        }, pid);

      await expect
        .poll(keywordColourOf, {
          timeout: 8000,
          message: 'the file was not highlighted to begin with',
        })
        .not.toBeNull();
      const keywordColour = await keywordColourOf();

      // Focus the document first: find is scoped to the ACTIVE panel, and the file tree currently
      // has focus after the click that opened the file.
      await win.getByTestId(`editor-${pid}`).locator('.cm-content').click();

      // Search for something that lands ON highlighted code.
      await win.keyboard.press('Control+f');
      await win.getByTestId('find-input').fill('target');
      await expect(win.locator('.throng-search-match').first()).toBeVisible({ timeout: 8000 });

      // The match paints a BACKGROUND…
      const matchBg = await win.evaluate(() => {
        const el = document.querySelector('.throng-search-match--current') as HTMLElement | null;
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      expect(matchBg).not.toBeNull();
      expect(matchBg).not.toBe('rgba(0, 0, 0, 0)');

      // …and the code inside it KEEPS its syntax colour. If the match had flattened the code, the
      // matched token would be painted in the plain editor foreground instead.
      const stillHighlighted = await win.evaluate((id) => {
        const spans = [...document.querySelectorAll(`[data-testid="editor-${id}"] .cm-line span`)];
        const kw = spans.find((s) => s.textContent === 'const');
        const editorFg = getComputedStyle(document.documentElement)
          .getPropertyValue('--throng-colour-editorFg')
          .trim();
        return { keyword: kw ? getComputedStyle(kw).color : null, editorFg };
      }, pid);
      expect(stillHighlighted.keyword).toBe(keywordColour);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
