/**
 * 073 US1, US2, US3 — the CSV Preview Editor and the spreadsheet preview in the real app.
 *
 * ══ WHY THIS IS AN E2E ══
 *
 * Each lower layer proves one side: `csv-grid-service.integration.test.ts` resolves an operation against
 * the real authority and writes real bytes, and `csv-body.test.ts` turns a grid commit into that operation.
 * Only the running app joins them — the preload bridge, the `throng:preview:grid*` channels, the default
 * open action routing a tree click to the preview, Ctrl+S reaching a preview's editor actions, and the
 * workbook bytes crossing the confined source route into the worker. Both journeys share one declaration, so the suite pays one.
 *
 * One app: nothing is seeded into the config root before launch.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { openApp, createProject, cleanupTemp, type OpenApp } from './harness.js';

const CSV = 'name,note\r\n"Smith, J","said ""hi"""\r\nLee,plain\r\n';

let shared: OpenApp | undefined;
let root = '';


test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-csv-preview-'));
  writeFileSync(join(root, 'people.csv'), CSV);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['first sheet']]), 'Alpha');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['second sheet']]), 'Beta');
  writeFileSync(join(root, 'book.xlsx'), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer);
  shared = await openApp();
  await createProject(shared.win, 'CsvPreview', root);
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/** Click a file in the tree (its default open action is Preview); the preview panel's id. */
async function previewFromTree(win: Page, file: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  // 074 FR-104: `<name> - <Type> Preview`, the type being the provider's display name.
  const title = `${file} - ${file.endsWith('.csv') ? 'CSV' : 'Spreadsheet'} Preview`;
  const heading = win
    .locator('[data-testid^="panel-title-"]')
    .filter({ hasText: new RegExp(`^${title.replace(/\./g, '\\.')}$`) })
    .first();
  await expect(heading).toBeVisible({ timeout: 8000 });
  const testId = await heading.getAttribute('data-testid');
  if (!testId) throw new Error(`previewFromTree(${file}): no preview panel titled ${title}`);
  return testId.replace('panel-title-', '');
}

test('a CSV cell edited in the grid saves only that field, and a workbook previews every sheet read-only', { tag: ['@extended', '@editor', '@reserve:runtime'] }, async () => {
  const win = shared!.win;
  const id = await previewFromTree(win, 'people.csv');
  const grid = win.getByTestId(`csv-grid-${id}`);
  const cell = (r: number, c: number) => grid.locator(`[data-grid-cell][data-row="${r}"][data-col="${c}"]`);
  await expect(cell(1, 0)).toHaveText('Smith, J', { timeout: 8000 });

  await cell(2, 1).click();
  await win.keyboard.press('Enter');
  const editor = win.getByLabel('Cell value');
  await editor.fill('now, with a comma');
  await win.keyboard.press('Enter');
  await expect(cell(2, 1)).toHaveText('now, with a comma');
  await expect(win.getByTestId(`panel-title-${id}`)).toHaveText(/people\.csv - CSV Preview/);

  await grid.focus();
  await win.keyboard.press('Control+S');
  // Every other byte kept: the CRLF endings, the doubled quote, the unedited records.
  await expect
    .poll(() => readFileSync(join(root, 'people.csv'), 'utf8'), { timeout: 8000 })
    .toBe('name,note\r\n"Smith, J","said ""hi"""\r\nLee,"now, with a comma"\r\n');

  // US3 — the workbook bytes cross the confined source route into the worker, in the same app.
  const bookId = await previewFromTree(win, 'book.xlsx');
  const firstCell = () => win.getByTestId(`spreadsheet-grid-${bookId}`).locator('[data-grid-cell][data-row="0"][data-col="0"]');
  await expect(firstCell()).toHaveText('first sheet', { timeout: 15_000 });
  await win.getByTestId('spreadsheet-sheet-Beta').click();
  await expect(firstCell()).toHaveText('second sheet');
  await win.keyboard.press('Enter');
  await expect(win.getByLabel('Cell value')).toHaveCount(0);
});
