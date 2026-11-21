/**
 * 073 SC-001, SC-002 — how fast a CSV and a workbook show their first screen, and that a workbook at the size limit
 * never freezes the window while it is read.
 *
 * - SC-001: a 10 MB, 100,000-row CSV shows its first screen in the CSV Preview Editor within 1.5 seconds of the open.
 * - SC-002: a 1 MB workbook shows its first sheet within 1.5 seconds, and one at the 25 MB limit within 8 seconds, with
 *   the rest of the app answering input throughout (no main-thread stall over 100 ms, as 074 SC-004 reads "never
 *   freezes").
 *
 * ══ WHERE THESE ARE ADJUDICATED ══
 *
 * Through `expectWithinSla`: asserted at one worker on reference hardware, recorded as an `sla-not-measured` reading
 * everywhere else, CI included (performance-sla.md). The spec is in the serial tier as TIMING for that reason. Take
 * the reading with `npx playwright test packages/ui/tests/e2e/csv-preview-performance.e2e.ts --workers=1`.
 *
 * The fixtures are generated into the test's temp root: none is committed. A workbook's cells are random hex so the
 * file does not compress to a fraction of its size; about 426 bytes of file per row of ten 32-character cells
 * (measured 2026-11-21).
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { openApp, createProject, cleanupTemp, type OpenApp } from './harness.js';
import { expectWithinSla } from './helpers/sla.js';

test.describe.configure({ mode: 'serial' });

const MB = 1024 * 1024;

/** A CSV of `rows` records, a header first, each record about 100 bytes. */
function bigCsv(rows: number): string {
  const out = ['id,name,city,amount,note'];
  for (let i = 0; i < rows; i++) out.push(`${i},name-${i},city-${i % 997},${(i * 7) % 100_000},a note about record ${i} padded to length`);
  return out.join('\r\n') + '\r\n';
}

/** A one-sheet workbook of about `bytes` on disk. */
function bookOf(bytes: number): Buffer {
  const rows = Math.ceil(bytes / 426);
  const data: string[][] = [['first sheet', ...Array.from({ length: 9 }, (_, c) => `col ${c + 2}`)]];
  for (let r = 1; r < rows; r++) data.push(Array.from({ length: 10 }, () => randomBytes(16).toString('hex')));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Data');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true }) as Buffer;
}

let shared: OpenApp | undefined;
let root = '';

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'throng-csv-perf-'));
  // Under the CSV preview's shipped 10 MB limit, with SC-001's 100,000 rows.
  writeFileSync(join(root, 'rows-100k.csv'), bigCsv(100_000));
  writeFileSync(join(root, 'book-1mb.xlsx'), bookOf(1 * MB));
  // Just under the 25 MB limit: a file over it is refused, not read.
  writeFileSync(join(root, 'book-25mb.xlsx'), bookOf(24 * MB));
  shared = await openApp();
  await createProject(shared.win, 'CsvPerf', root);
});

test.afterAll(async () => {
  await shared?.close();
  if (root) cleanupTemp(root);
});

/** Click a file in the tree (its default open action is Preview); the preview panel's id. */
async function previewFromTree(win: Page, file: string): Promise<string> {
  await win.getByTestId('file-explorer-tree').getByText(file, { exact: true }).click();
  const title = `${file} - ${file.endsWith('.csv') ? 'CSV' : 'Spreadsheet'} Preview`;
  const heading = win
    .locator('[data-testid^="panel-title-"]')
    .filter({ hasText: new RegExp(`^${title.replace(/\./g, '\\.')}$`) })
    .first();
  // Attached, not visible: in a narrow window the header has no room to show its title (csv-preview-editor.e2e.ts).
  await expect(heading).toBeAttached({ timeout: 10_000 });
  const testId = await heading.getAttribute('data-testid');
  if (!testId) throw new Error(`previewFromTree(${file}): no preview panel titled ${title}`);
  return testId.replace('panel-title-', '');
}

test('a 10 MB, 100,000-row CSV shows its first screen within 1.5 seconds (SC-001)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  expect(statSync(join(root, 'rows-100k.csv')).size).toBeGreaterThan(9 * MB);
  const started = Date.now();
  const id = await previewFromTree(win, 'rows-100k.csv');
  const grid = win.getByTestId(`csv-grid-${id}`);
  await expect(grid.locator('[data-grid-cell][data-row="0"][data-col="0"]')).toHaveText('id', { timeout: 20_000 });
  await expect(grid.locator('[data-grid-cell][data-row="1"][data-col="1"]')).toHaveText('name-0');
  expectWithinSla(test.info(), { what: 'a 10 MB, 100,000-row CSV, click to first screen', requirement: '073 SC-001', elapsedMs: Date.now() - started, budgetMs: 1500 });
});

test('a workbook shows its first sheet within 1.5 s at 1 MB and 8 s at the 25 MB limit, never freezing the window (SC-002)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const win = shared!.win;
  const firstCell = (id: string) => win.getByTestId(`spreadsheet-grid-${id}`).locator('[data-grid-cell][data-row="0"][data-col="0"]');

  let started = Date.now();
  const small = await previewFromTree(win, 'book-1mb.xlsx');
  await expect(firstCell(small)).toHaveText('first sheet', { timeout: 20_000 });
  expectWithinSla(test.info(), { what: 'a 1 MB workbook, click to first sheet', requirement: '073 SC-002', elapsedMs: Date.now() - started, budgetMs: 1500 });

  // Long tasks from here on: every main-thread stall over 50 ms the renderer reports while the big workbook is read.
  await win.evaluate(() => {
    const g = window as unknown as { __longTasks?: number[] };
    g.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) g.__longTasks?.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  expect(statSync(join(root, 'book-25mb.xlsx')).size).toBeGreaterThan(20 * MB);
  started = Date.now();
  const big = await previewFromTree(win, 'book-25mb.xlsx');
  await expect(firstCell(big)).toHaveText('first sheet', { timeout: 60_000 });
  expectWithinSla(test.info(), { what: 'a 25 MB workbook, click to first sheet', requirement: '073 SC-002', elapsedMs: Date.now() - started, budgetMs: 8000 });
  const longest = await win.evaluate(() => Math.max(0, ...((window as unknown as { __longTasks?: number[] }).__longTasks ?? [])));
  expectWithinSla(test.info(), { what: 'the longest main-thread stall reading a 25 MB workbook', requirement: '073 SC-002', elapsedMs: Math.round(longest), budgetMs: 100 });
});
