/**
 * 073 FR-008, FR-024, FR-025, FR-037 — the grid's pure selection and navigation model.
 * Layer: unit — every rule is arithmetic over plain data; the component test proves only the wiring.
 */
import { describe, expect, it } from 'vitest';
import {
  afterCommit,
  clampSelection,
  coversColumn,
  coversRow,
  indexAtOffset,
  inRange,
  isPrintableKey,
  moveSelection,
  rangeOf,
  selectAll,
  selectColumn,
  selectRow,
  single,
  type GridMoveKey,
  type GridMoveOptions,
} from '../../src/renderer/grid/grid-selection.js';

const base: GridMoveOptions = { rowCount: 100, colCount: 10, pageRows: 20, extend: false };

function move(from: ReturnType<typeof single>, key: GridMoveKey, over: Partial<GridMoveOptions> = {}) {
  return moveSelection(from, key, { ...base, ...over });
}

describe('rangeOf', () => {
  it('normalises a backwards selection', () => {
    const sel = { anchor: { row: 5, col: 4 }, active: { row: 2, col: 1 } };
    expect(rangeOf(sel)).toEqual({ top: 2, left: 1, bottom: 5, right: 4 });
  });

  it('spans every column for a whole-row selection', () => {
    const sel = { anchor: { row: 3, col: 0 }, active: { row: 6, col: 0 }, rows: true };
    expect(rangeOf(sel, 8)).toEqual({ top: 3, left: 0, bottom: 6, right: 7 });
  });

  it('answers inRange for the edges and just outside', () => {
    const r = { top: 1, left: 1, bottom: 2, right: 3 };
    expect([inRange(r, 1, 1), inRange(r, 2, 3), inRange(r, 0, 1), inRange(r, 2, 4)]).toEqual([true, true, false, false]);
  });
});

describe('moveSelection', () => {
  it('moves one cell with the arrows and stays inside the grid', () => {
    expect(move(single(5, 5), 'ArrowDown').active).toEqual({ row: 6, col: 5 });
    expect(move(single(5, 5), 'ArrowLeft').active).toEqual({ row: 5, col: 4 });
    expect(move(single(0, 0), 'ArrowUp').active).toEqual({ row: 0, col: 0 });
    expect(move(single(0, 0), 'ArrowLeft').active).toEqual({ row: 0, col: 0 });
    expect(move(single(99, 9), 'ArrowDown').active).toEqual({ row: 99, col: 9 });
    expect(move(single(99, 9), 'ArrowRight').active).toEqual({ row: 99, col: 9 });
  });

  it('collapses the anchor onto the destination without Shift', () => {
    const from = { anchor: { row: 1, col: 1 }, active: { row: 4, col: 4 } };
    const out = move(from, 'ArrowRight');
    expect(out.anchor).toEqual(out.active);
  });

  it('keeps the anchor and moves the active end with Shift', () => {
    const out = move(single(5, 5), 'ArrowDown', { extend: true });
    expect(out.anchor).toEqual({ row: 5, col: 5 });
    expect(out.active).toEqual({ row: 6, col: 5 });
  });

  it('pages by the visible row count, clamped at both ends', () => {
    expect(move(single(30, 2), 'PageDown').active.row).toBe(50);
    expect(move(single(30, 2), 'PageUp').active.row).toBe(10);
    expect(move(single(95, 2), 'PageDown').active.row).toBe(99);
    expect(move(single(3, 2), 'PageUp').active.row).toBe(0);
  });

  it('treats a page of zero as one row', () => {
    expect(move(single(5, 2), 'PageDown', { pageRows: 0 }).active.row).toBe(6);
  });

  it('Home and End go to the row ends; with Ctrl to the grid corners', () => {
    expect(move(single(7, 4), 'Home').active).toEqual({ row: 7, col: 0 });
    expect(move(single(7, 4), 'End').active).toEqual({ row: 7, col: 9 });
    expect(move(single(7, 4), 'Home', { ctrl: true }).active).toEqual({ row: 0, col: 0 });
    expect(move(single(7, 4), 'End', { ctrl: true }).active).toEqual({ row: 99, col: 9 });
  });

  it('Tab and Shift+Tab move right and left and never extend', () => {
    expect(move(single(2, 2), 'Tab').active).toEqual({ row: 2, col: 3 });
    expect(move(single(2, 2), 'ShiftTab').active).toEqual({ row: 2, col: 1 });
    const out = move(single(2, 2), 'Tab', { extend: true });
    expect(out.anchor).toEqual(out.active);
  });

  it('copes with a one-cell grid', () => {
    const one = { rowCount: 1, colCount: 1 };
    expect(move(single(0, 0), 'ArrowDown', one).active).toEqual({ row: 0, col: 0 });
    expect(move(single(0, 0), 'End', { ...one, ctrl: true }).active).toEqual({ row: 0, col: 0 });
  });

  it('extends a whole-row selection vertically and keeps it whole-row', () => {
    const rows = selectRow(4);
    const out = move(rows, 'ArrowDown', { extend: true });
    expect(out.rows).toBe(true);
    expect(rangeOf(out, 10)).toEqual({ top: 4, left: 0, bottom: 5, right: 9 });
  });
});

describe('selection constructors', () => {
  it('selectAll covers every cell', () => {
    expect(rangeOf(selectAll(4, 3))).toEqual({ top: 0, left: 0, bottom: 3, right: 2 });
    expect(rangeOf(selectAll(0, 0))).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
  });

  it('selectRow and Shift-extended selectRow keep the anchor row', () => {
    const first = selectRow(2);
    const extended = selectRow(6, first);
    expect(first.rows).toBe(true);
    expect(rangeOf(extended, 5)).toEqual({ top: 2, left: 0, bottom: 6, right: 4 });
    expect(coversRow(extended, 4)).toBe(true);
    expect(coversRow(extended, 7)).toBe(false);
    expect(coversRow(single(4, 0), 4)).toBe(false);
  });

  it('selectColumn spans every row and extends from the anchor column', () => {
    const first = selectColumn(2, 50);
    const extended = selectColumn(4, 50, first);
    expect(rangeOf(extended)).toEqual({ top: 0, left: 2, bottom: 49, right: 4 });
    expect(coversColumn(extended, 3, 50)).toBe(true);
    expect(coversColumn(extended, 5, 50)).toBe(false);
    expect(coversColumn(single(0, 3), 3, 50)).toBe(false);
  });

  it('a selected column’s active cell is its top row, so the next arrow key moves from there (FR-008a)', () => {
    expect(selectColumn(2, 50).active).toEqual({ row: 0, col: 2 });
    expect(selectColumn(4, 50, selectColumn(2, 50)).active).toEqual({ row: 0, col: 4 });
  });
});

describe('clampSelection (FR-025)', () => {
  it('returns the same object when nothing is out of range', () => {
    const sel = single(2, 2);
    expect(clampSelection(sel, 10, 10)).toBe(sel);
  });

  it('pulls both ends back into a shrunken grid and keeps the rows flag', () => {
    const sel = { anchor: { row: 8, col: 9 }, active: { row: 20, col: 30 }, rows: true };
    expect(clampSelection(sel, 5, 4)).toEqual({ anchor: { row: 4, col: 3 }, active: { row: 4, col: 3 }, rows: true });
  });
});

describe('afterCommit', () => {
  it('moves down or right and stops at the last row and column', () => {
    expect(afterCommit({ row: 1, col: 1 }, 'down', 5, 5)).toEqual({ row: 2, col: 1 });
    expect(afterCommit({ row: 1, col: 1 }, 'right', 5, 5)).toEqual({ row: 1, col: 2 });
    expect(afterCommit({ row: 4, col: 4 }, 'down', 5, 5)).toEqual({ row: 4, col: 4 });
    expect(afterCommit({ row: 4, col: 4 }, 'right', 5, 5)).toEqual({ row: 4, col: 4 });
    expect(afterCommit({ row: 1, col: 1 }, 'none', 5, 5)).toEqual({ row: 1, col: 1 });
  });
});

describe('isPrintableKey', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'altGraph', boolean>> = {}) => {
    const { altGraph = false, ...rest } = mods;
    return isPrintableKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...rest, getModifierState: (m) => m === 'AltGraph' && altGraph });
  };

  it('accepts a character and a space', () => {
    expect(key('a')).toBe(true);
    expect(key(' ')).toBe(true);
  });

  it('rejects named keys, Ctrl, Ctrl+Alt and Cmd chords, and accepts AltGr', () => {
    expect(key('Enter')).toBe(false);
    expect(key('c', { ctrlKey: true })).toBe(false);
    expect(key('c', { metaKey: true })).toBe(false);
    // Ctrl+Alt+S is Save As (MT-02 walk-through): a command, not an "s".
    expect(key('s', { ctrlKey: true, altKey: true })).toBe(false);
    // AltGr on Windows: Ctrl+Alt flagged AltGraph.
    expect(key('@', { ctrlKey: true, altKey: true, altGraph: true })).toBe(true);
  });
});

describe('indexAtOffset', () => {
  const spans = [
    { start: 0, end: 10 },
    { start: 10, end: 30 },
    { start: 30, end: 40 },
  ];

  it('finds the span containing an offset and clamps to the ends', () => {
    expect(indexAtOffset(spans, 0)).toBe(0);
    expect(indexAtOffset(spans, 29)).toBe(1);
    expect(indexAtOffset(spans, 30)).toBe(2);
    expect(indexAtOffset(spans, 500)).toBe(2);
    expect(indexAtOffset(spans, -5)).toBe(0);
    expect(indexAtOffset([], 4)).toBe(0);
  });
});
