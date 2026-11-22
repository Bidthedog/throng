/**
 * #683 — View Whitespace never changes line height, in any shipped theme (059 FR-065/FR-066).
 *
 * Layer: E2E (@reserve:layout). The defect is a line box one pixel taller with the markers on, decided by the
 * editor font's real ascent against CodeMirror's widget buffers; jsdom lays nothing out, so no lower layer can measure it.
 *
 * One app, every shipped theme in turn through the hot-reloaded settings file, whitespace off then on for each.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_THEMES } from '@throng/core';
import { runApp, createProject, cleanupTemp } from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';

/** The height of each of the first six lines, which between them carry every kind of marker. */
async function lineHeights(win: Page): Promise<number[]> {
  return win.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.editor-panel .cm-line')]
      .slice(0, 6)
      .map((line) => Math.round(line.getBoundingClientRect().height * 100) / 100),
  );
}

test('View Whitespace keeps every line its height in every shipped theme (#683)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const themes = Object.keys(DEFAULT_THEMES);
  test.setTimeout(60_000 + themes.length * 10_000);
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfg-ws-'));
  const root = mkdtempSync(join(tmpdir(), 'throng-ws-'));
  // A BOM, a space, a tab and a control character, each on a line ending in LF: every marker the toggle draws.
  const bom = String.fromCharCode(0xfeff);
  const bell = String.fromCharCode(7);
  writeFileSync(join(root, 'notes.txt'), `${bom}alpha beta\n\tgamma\nde${bell}lta\nepsilon\nzeta eta\ntheta\n`);
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Whitespace', root);
        await win.getByTestId('file-explorer-tree').getByText('notes.txt', { exact: true }).dblclick();
        await expect(win.locator('.editor-panel .cm-line').first()).toBeVisible({ timeout: 15_000 });
        const markers = win.locator('.editor-panel .cm-ws-eol');

        for (const theme of themes) {
          // The theme and the toggle arrive in ONE settings document, so the markers appearing proves the theme is
          // applied too; the heights with them on are then the reference the same theme with them off must match.
          writeSettingsAtomic(cfg, { appearance: { theme }, editor: { defaultShowWhitespace: true } });
          await expect.poll(() => markers.count(), { timeout: 8000, message: `${theme}: whitespace on` }).toBeGreaterThan(0);
          const on = await lineHeights(win);

          writeSettingsAtomic(cfg, { appearance: { theme }, editor: { defaultShowWhitespace: false } });
          await expect.poll(() => markers.count(), { timeout: 8000, message: `${theme}: whitespace off` }).toBe(0);
          expect(await lineHeights(win), `${theme}: line heights with whitespace off, against on`).toEqual(on);
        }
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupTemp(root);
    cleanupTemp(cfg);
  }
});
