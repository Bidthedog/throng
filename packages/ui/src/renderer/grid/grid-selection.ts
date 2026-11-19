/**
 * The grid's selection and keyboard-navigation model (073 FR-008, FR-024, FR-037; contracts/grid-ui.md
 * "Keys inside the grid"). Pure functions over plain data: no DOM, no React, so every movement rule is
 * unit-testable and `data-grid.tsx` stays a thin shell over it.
 *
 * Coordinates are 0-based; ranges are inclusive. A grid always has at least one row and one column
 * (an empty table shows one empty cell), so callers pass `Math.max(1, count)`.
 */

export interface GridCell {
  row: number;
  col: number;
}

/** The anchor is where a selection started, the active cell is its moving end (and the keyboard focus). */
export interface GridSelection {
  anchor: GridCell;
  active: GridCell;
  /** Whole rows picked through the row-number gutter: the range then spans every column. */
  rows?: boolean;
}

/** An inclusive rectangle of cells. */
export interface GridRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type GridMoveKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'PageUp'
  | 'PageDown'
  | 'Home'
  | 'End'
  | 'Tab'
  | 'ShiftTab';

export interface GridMoveOptions {
  rowCount: number;
  colCount: number;
  /** Rows a Page Up / Page Down jumps: the number of rows visible. */
  pageRows: number;
  /** Shift held: move the active end only, keep the anchor. */
  extend: boolean;
  /** Ctrl (or Cmd) held: Home / End go to the first / last cell of the whole grid. */
  ctrl?: boolean;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

export function cell(row: number, col: number): GridCell {
  return { row, col };
}

/** A single-cell selection. */
export function single(row: number, col: number): GridSelection {
  return { anchor: cell(row, col), active: cell(row, col) };
}

/** Pulls every coordinate of a selection back inside the grid (FR-025: kept across a content update). */
export function clampSelection(sel: GridSelection, rowCount: number, colCount: number): GridSelection {
  const lastRow = Math.max(0, rowCount - 1);
  const lastCol = Math.max(0, colCount - 1);
  const anchor = cell(clamp(sel.anchor.row, 0, lastRow), clamp(sel.anchor.col, 0, lastCol));
  const active = cell(clamp(sel.active.row, 0, lastRow), clamp(sel.active.col, 0, lastCol));
  if (
    anchor.row === sel.anchor.row &&
    anchor.col === sel.anchor.col &&
    active.row === sel.active.row &&
    active.col === sel.active.col
  ) {
    return sel;
  }
  const out: GridSelection = { anchor, active };
  if (sel.rows) out.rows = true;
  return out;
}

/** The rectangle a selection covers. With `rows` set and a column count, it spans every column. */
export function rangeOf(sel: GridSelection, colCount?: number): GridRange {
  const top = Math.min(sel.anchor.row, sel.active.row);
  const bottom = Math.max(sel.anchor.row, sel.active.row);
  if (sel.rows && colCount !== undefined) return { top, left: 0, bottom, right: Math.max(0, colCount - 1) };
  return {
    top,
    bottom,
    left: Math.min(sel.anchor.col, sel.active.col),
    right: Math.max(sel.anchor.col, sel.active.col),
  };
}

export function inRange(range: GridRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** Ctrl+A: every cell, active end at the bottom-right. */
export function selectAll(rowCount: number, colCount: number): GridSelection {
  return { anchor: cell(0, 0), active: cell(Math.max(0, rowCount - 1), Math.max(0, colCount - 1)) };
}

/** One whole row (gutter click); `extendFrom` keeps that selection's anchor row (Shift+click). */
export function selectRow(row: number, extendFrom?: GridSelection): GridSelection {
  const anchorRow = extendFrom ? extendFrom.anchor.row : row;
  return { anchor: cell(anchorRow, 0), active: cell(row, 0), rows: true };
}

/** One whole column (header click); `extendFrom` keeps that selection's anchor column (Shift+click). */
export function selectColumn(col: number, rowCount: number, extendFrom?: GridSelection): GridSelection {
  const anchorCol = extendFrom ? extendFrom.anchor.col : col;
  return { anchor: cell(0, anchorCol), active: cell(Math.max(0, rowCount - 1), col) };
}

/** True when the selection covers the whole of `col` from top to bottom. */
export function coversColumn(sel: GridSelection, col: number, rowCount: number): boolean {
  const r = rangeOf(sel);
  return !sel.rows && r.top === 0 && r.bottom === Math.max(0, rowCount - 1) && col >= r.left && col <= r.right;
}

/** True when the selection is whole rows containing `row`. */
export function coversRow(sel: GridSelection, row: number): boolean {
  if (!sel.rows) return false;
  const r = rangeOf(sel);
  return row >= r.top && row <= r.bottom;
}

/**
 * Where a navigation key takes the selection. Moving without Shift collapses to the single destination
 * cell; with Shift the anchor stays and only the active end moves. Moving never leaves the grid, and a
 * whole-row selection stays a whole-row selection while it is extended vertically.
 */
export function moveSelection(sel: GridSelection, key: GridMoveKey, opts: GridMoveOptions): GridSelection {
  const lastRow = Math.max(0, opts.rowCount - 1);
  const lastCol = Math.max(0, opts.colCount - 1);
  const page = Math.max(1, opts.pageRows);
  let { row, col } = sel.active;
  const ctrl = opts.ctrl === true;

  switch (key) {
    case 'ArrowUp':
      row -= 1;
      break;
    case 'ArrowDown':
      row += 1;
      break;
    case 'ArrowLeft':
    case 'ShiftTab':
      col -= 1;
      break;
    case 'ArrowRight':
    case 'Tab':
      col += 1;
      break;
    case 'PageUp':
      row -= page;
      break;
    case 'PageDown':
      row += page;
      break;
    case 'Home':
      col = 0;
      if (ctrl) row = 0;
      break;
    case 'End':
      col = lastCol;
      if (ctrl) row = lastRow;
      break;
  }
  const active = cell(clamp(row, 0, lastRow), clamp(col, 0, lastCol));
  // Tab and Shift+Tab always move the cursor, never extend (they are focus-style keys).
  const extend = opts.extend && key !== 'Tab' && key !== 'ShiftTab';
  if (!extend) return { anchor: active, active };
  if (sel.rows) return { anchor: sel.anchor, active: cell(active.row, 0), rows: true };
  return { anchor: sel.anchor, active };
}

/** The cell a commit moves to: one down or one right, staying inside the grid. */
export function afterCommit(
  active: GridCell,
  move: 'down' | 'right' | 'none',
  rowCount: number,
  colCount: number,
): GridCell {
  if (move === 'down') return cell(Math.min(active.row + 1, Math.max(0, rowCount - 1)), active.col);
  if (move === 'right') return cell(active.row, Math.min(active.col + 1, Math.max(0, colCount - 1)));
  return active;
}

/** True when a keydown would insert a printable character (so it should start a cell edit). */
export function isPrintableKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  if (e.key.length !== 1) return false;
  if (e.metaKey) return false;
  // AltGr reports ctrl+alt on Windows; a bare Ctrl chord is a command, not text.
  return !e.ctrlKey || e.altKey;
}

/** Index of the item containing `offset` in sorted `[start, end)` spans; clamped to the ends. */
export function indexAtOffset(spans: ReadonlyArray<{ start: number; end: number }>, offset: number): number {
  if (spans.length === 0) return 0;
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((spans[mid] as { start: number }).start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
