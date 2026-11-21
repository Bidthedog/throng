/**
 * What a workbook reads as (073 FR-050 – FR-053, FR-056, data-model §6; research R6).
 *
 * Runs inside the spreadsheet worker (FR-055), never on the renderer's main thread. SheetJS reads the
 * bytes with everything that could act on the content switched off:
 *
 * - `bookVBA: false` — a macro project is not even extracted, let alone run (FR-054, SC-007);
 * - `cellFormula: false` — a formula's text is not kept, and nothing is recalculated: a cell shows the
 *   value the file stored (FR-052);
 * - `cellHTML: false`, `cellStyles: false` — no rich text markup and no styles; a cell is text (FR-005,
 *   FR-053).
 *
 * SheetJS has no network code, and the worker could not fetch anything past the renderer's CSP if it
 * did. A cell shows its formatted text (`w`) where the file holds one, an ISO 8601 date for a date
 * without one, and its raw value otherwise.
 */
import * as XLSX from 'xlsx';
import { logExpected } from '@throng/core';

export interface WorkbookSheet {
  name: string;
  hidden: boolean;
  /** Rows of display text, dense from A1; short rows are not padded. */
  rows: string[][];
  /** The widest row's cell count. */
  width: number;
}

/** `reader` (073 FR-056, T092): the reader itself could not start or stopped, which says nothing about the file. */
export type WorkbookRefusal = 'password' | 'malformed' | 'unsupported' | 'reader';

export type WorkbookRead =
  | { ok: true; sheets: WorkbookSheet[] }
  | { ok: false; reason: WorkbookRefusal; detail: string };

/** The options every read uses — exported so a test can pin them (SC-007). */
export const WORKBOOK_READ_OPTIONS: XLSX.ParsingOptions = {
  type: 'array',
  dense: true,
  cellDates: true,
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  bookVBA: false,
  WTF: false,
};

function isoDate(d: Date): string {
  const iso = d.toISOString();
  // A date with no time of day reads as a date; one with a time keeps it.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace(/\.000Z$/, 'Z');
}

/** A cell's display text (FR-053). Exported for its test. */
export function cellDisplay(cell: XLSX.CellObject | undefined): string {
  if (cell === undefined || cell === null) return '';
  if (typeof cell.w === 'string') return cell.w;
  const v = cell.v;
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return isoDate(v);
  return String(v);
}

function refusalOf(error: unknown): { reason: WorkbookRefusal; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  if (/password/i.test(detail)) return { reason: 'password', detail };
  // A truncated or corrupt zip reads as "Unsupported ZIP encryption": damage, not a password.
  if (/zip encryption/i.test(detail)) return { reason: 'malformed', detail };
  if (/encrypt/i.test(detail)) return { reason: 'password', detail };
  if (/unsupported|not supported/i.test(detail)) return { reason: 'unsupported', detail };
  return { reason: 'malformed', detail };
}

function sheetRows(sheet: XLSX.WorkSheet | undefined): { rows: string[][]; width: number } {
  if (sheet === undefined) return { rows: [], width: 0 };
  const ref = sheet['!ref'];
  if (ref === undefined) return { rows: [], width: 0 };
  const range = XLSX.utils.decode_range(ref);
  const data = (sheet['!data'] ?? []) as (XLSX.CellObject[] | undefined)[];
  const rows: string[][] = [];
  let width = 0;
  for (let r = 0; r <= range.e.r; r++) {
    const source = data[r];
    const row: string[] = [];
    if (source !== undefined) {
      for (let c = 0; c <= range.e.c && c < source.length; c++) row.push(cellDisplay(source[c]));
      // Trailing empty cells are not part of the row's width.
      while (row.length > 0 && row[row.length - 1] === '') row.pop();
    }
    if (row.length > width) width = row.length;
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1]?.length === 0) rows.pop();
  return { rows, width };
}

/** Read `bytes` as a workbook. Never throws: every failure is a named refusal (FR-056). */
export function readWorkbook(bytes: ArrayBuffer): WorkbookRead {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(new Uint8Array(bytes), WORKBOOK_READ_OPTIONS);
  } catch (error) {
    logExpected('workbook-read: read', 'a protected, damaged or unsupported workbook is refused with its reason', error);
    return { ok: false, ...refusalOf(error) };
  }
  if (book.SheetNames.length === 0) return { ok: false, reason: 'malformed', detail: 'The workbook has no sheets.' };
  const props = book.Workbook?.Sheets ?? [];
  const sheets = book.SheetNames.map((name, i) => {
    const { rows, width } = sheetRows(book.Sheets[name]);
    return { name, hidden: (props[i]?.Hidden ?? 0) !== 0, rows, width };
  });
  return { ok: true, sheets };
}
