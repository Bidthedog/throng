import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';

// 009 US3 / FR-011 / FR-014: the editor gutter has its own themeable background
// and foreground tokens; changing them repaints ONLY the gutter, not the editor
// body; and a theme document that predates the gutter tokens inherits the default
// gutter colours (no migration, still loads).

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-gutter-'));
  writeFileSync(join(root, 'lines.txt'), 'one\ntwo\nthree\nfour\n');
  return root;
}

async function openEditorWithFile(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  await win.getByTestId(`editor-${pid}`).click();
  await win.getByTestId('file-explorer-tree').getByText('lines.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('one', {
    timeout: 8000,
  });
  return pid;
}

const bg = (win: Page, sel: string): Promise<string> =>
  win.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);
const fg = (win: Page, sel: string): Promise<string> =>
  win.evaluate((s) => getComputedStyle(document.querySelector(s)!).color, sel);

test('gutter tokens paint only the gutter, not the editor body', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = makeProject();
  try {
    mkdirSync(join(cfg, 'themes'), { recursive: true });
    writeFileSync(
      join(cfg, 'themes', 'throng.json'),
      JSON.stringify({
        name: 'throng',
        colours: {
          editorBg: '#010203',
          editorFg: '#e0e1e2',
          editorGutterBg: '#204060',
          editorGutterFg: '#a0b0c0',
        },
      }),
      'utf8',
    );
    await runApp(
      async (_app, win) => {
        await createProject(win, 'GutterProj', root);
        await openEditorWithFile(win);

        // Gutter paints from the gutter tokens.
        await expect
          .poll(() => bg(win, '.editor-panel .cm-gutters'), { timeout: 8000 })
          .toBe('rgb(32, 64, 96)');
        expect(await fg(win, '.editor-panel .cm-gutters')).toBe('rgb(160, 176, 192)');

        // The editor body keeps the editor background — the gutter tokens did NOT
        // bleed into it (distinct from the gutter surface).
        expect(await bg(win, '.editor-panel .cm-editor')).toBe('rgb(1, 2, 3)');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});

/*
 * #384 — the gutter is chrome, not content: its line numbers cannot be selected as text.
 *
 * Text selection is off app-wide and re-enabled on `.cm-editor`, and that re-enable reached the
 * gutter too, so a double-click on a line number or a drag down the gutter painted a selection over
 * numbers that are not part of the document. Whether a real mouse starts a selection is the engine's
 * input handling against the cascaded `user-select`, which jsdom does not apply — hence this layer.
 * The control is the body: a double-click there still selects a word.
 */
test('the gutter line numbers cannot be selected; the document body still can (#384)', { tag: ['@extended', '@editor', '@reserve:input'] }, async () => {
  const root = makeProject();
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'GutterProj', root);
      const pid = await openEditorWithFile(win);
      const editor = win.getByTestId(`editor-${pid}`);
      const selected = (): Promise<string> => win.evaluate(() => window.getSelection()?.toString() ?? '');

      // Control: the document body is selectable.
      await editor.locator('.cm-line', { hasText: 'three' }).dblclick();
      await expect.poll(selected).toBe('three');

      // Collapse it, then double-click a line number.
      await editor.locator('.cm-line', { hasText: 'one' }).click();
      const numbers = editor.locator('.cm-lineNumbers .cm-gutterElement');
      await numbers.filter({ hasText: /^2$/ }).dblclick();
      expect(await selected(), 'a double-click on a line number selected gutter text').toBe('');

      // And a drag down the gutter, from line 1's number to line 4's.
      const from = await numbers.filter({ hasText: /^1$/ }).boundingBox();
      const to = await numbers.filter({ hasText: /^4$/ }).boundingBox();
      if (!from || !to) throw new Error('the gutter line numbers have no layout');
      await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await win.mouse.down();
      await win.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await win.mouse.up();
      expect(await selected(), 'a drag down the gutter selected gutter text').not.toMatch(/\d/);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a theme without gutter tokens inherits the default gutter colours (no migration)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  const root = makeProject();
  try {
    mkdirSync(join(cfg, 'themes'), { recursive: true });
    // A pre-009 theme document: no editorGutter* tokens at all.
    writeFileSync(
      join(cfg, 'themes', 'throng.json'),
      JSON.stringify({ name: 'throng', colours: { editorBg: '#020202' } }),
      'utf8',
    );
    await runApp(
      async (_app, win) => {
        await createProject(win, 'GutterProj', root);
        await openEditorWithFile(win);
        // Falls back to the built-in default gutter background (#151a23).
        await expect
          .poll(
            () =>
              win.evaluate(() =>
                getComputedStyle(document.documentElement)
                  .getPropertyValue('--throng-colour-editorGutterBg')
                  .trim(),
              ),
            { timeout: 8000 },
          )
          .toBe('#151a23');
        expect(await bg(win, '.editor-panel .cm-gutters')).toBe('rgb(21, 26, 35)');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(cfg);
    cleanupTemp(root);
  }
});
