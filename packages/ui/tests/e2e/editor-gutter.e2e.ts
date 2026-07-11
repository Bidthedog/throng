import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

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

test('gutter tokens paint only the gutter, not the editor body', async () => {
  skipIfElevated();
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
    rmSync(cfg, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a theme without gutter tokens inherits the default gutter colours (no migration)', async () => {
  skipIfElevated();
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
    rmSync(cfg, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
