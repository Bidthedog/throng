/**
 * The last whole rows or whole columns copied or cut from a CSV grid (073 FR-038a).
 *
 * Insert Copied Rows / Columns need the VALUES of what was copied, not just the clipboard's text, so the
 * grid keeps one record per window: what the last whole-row or whole-column copy held, and the text that
 * copy wrote. The record is only ever believed while the clipboard still holds exactly that text; any other
 * copy, in or out of throng, makes it stale without anything having to clear it.
 */
import { gridToTsv } from '@throng/core';
import { cellsOf } from './grid-copy.js';
import type { GridRange, GridSelection } from './grid-selection.js';

export interface CopiedBlock {
  kind: 'rows' | 'columns';
  /** `rows`: one array per row. `columns`: one array per column, `values[k][row]`. */
  values: string[][];
  /** The plain text the copy put on the clipboard. */
  text: string;
}

let last: CopiedBlock | null = null;

/** Tests only. */
export function __resetCopiedBlock(): void {
  last = null;
}

/** Line endings differ between what was written and what a platform clipboard hands back. */
const normal = (text: string): string => text.replace(/\r\n?/g, '\n');

/**
 * Record a copy or cut of `range`. Whole rows (a row-header selection) and whole columns (every record of
 * the table) are kept; anything else, including a copy too large to keep whole, clears the record.
 */
export function recordCopy(
  sel: GridSelection,
  range: GridRange,
  rowCount: number,
  getCell: (row: number, col: number) => string,
): void {
  const wholeRows = sel.rows === true;
  const wholeColumns = !wholeRows && rowCount > 0 && range.top === 0 && range.bottom >= rowCount - 1;
  if (!wholeRows && !wholeColumns) {
    last = null;
    return;
  }
  const cells = cellsOf(range, getCell);
  // `cellsOf` is capped; a block cut short would insert fewer values than were copied.
  if (cells.length !== range.bottom - range.top + 1) {
    last = null;
    return;
  }
  const text = gridToTsv(cells);
  if (wholeRows) {
    last = { kind: 'rows', values: cells, text };
    return;
  }
  const width = range.right - range.left + 1;
  last = { kind: 'columns', values: Array.from({ length: width }, (_, k) => cells.map((row) => row[k] ?? '')), text };
}

/** The recorded block, when it is of `kind` and the clipboard's `clipboardText` is still what it wrote. */
export function copiedBlockFor(kind: CopiedBlock['kind'], clipboardText: string): CopiedBlock | null {
  if (last === null || last.kind !== kind) return null;
  return normal(last.text) === normal(clipboardText) ? last : null;
}

/** Whether a block of `kind` is recorded at all — a cheap test before the clipboard is read. */
export function hasCopiedBlock(kind: CopiedBlock['kind']): boolean {
  return last?.kind === kind;
}
