import { describe, expect, it } from 'vitest';
import { NAME_COLUMN_MIN_WIDTH, fitColumns, type FitColumn } from '../../../src/resources/index.js';

/** 055 FR-106 — the left list drops figure columns from the right instead of scrolling sideways. */

const COLUMNS: readonly FitColumn[] = [
  { id: 'trend', width: 60 },
  { id: 'cpu', width: 70 },
  { id: 'memory', width: 90 },
  { id: 'gpu', width: 70 },
  { id: 'io', width: 90 },
  { id: 'network', width: 90 },
];
const ALL = COLUMNS.reduce((sum, c) => sum + c.width, NAME_COLUMN_MIN_WIDTH);

describe('fitColumns (FR-106)', () => {
  it('shows every column when they fit', () => {
    expect(fitColumns(ALL, COLUMNS, 'cpu')).toEqual({
      visible: ['trend', 'cpu', 'memory', 'gpu', 'io', 'network'],
      hidden: [],
    });
  });

  it('drops columns from the right edge, one at a time, as the width shrinks', () => {
    expect(fitColumns(ALL - 1, COLUMNS, 'cpu').hidden).toEqual(['network']);
    expect(fitColumns(ALL - 91, COLUMNS, 'cpu').hidden).toEqual(['io', 'network']);
  });

  it('drops the Order-by column last, keeping it where it sits', () => {
    const { visible, hidden } = fitColumns(NAME_COLUMN_MIN_WIDTH + 100, COLUMNS, 'network');
    expect(visible).toEqual(['network']);
    expect(hidden).toEqual(['trend', 'cpu', 'memory', 'gpu', 'io']);
    expect(fitColumns(NAME_COLUMN_MIN_WIDTH + 160, COLUMNS, 'memory').visible).toEqual(['trend', 'memory']);
  });

  it('always keeps the name: with no room for any figure, every figure is hidden', () => {
    expect(fitColumns(NAME_COLUMN_MIN_WIDTH, COLUMNS, 'cpu')).toEqual({
      visible: [],
      hidden: ['trend', 'cpu', 'memory', 'gpu', 'io', 'network'],
    });
    expect(fitColumns(0, COLUMNS, 'cpu').visible).toEqual([]);
  });

  it('lists the hidden columns in their display order', () => {
    expect(fitColumns(NAME_COLUMN_MIN_WIDTH + 70, COLUMNS, 'gpu').hidden).toEqual(['trend', 'cpu', 'memory', 'io', 'network']);
  });
});
