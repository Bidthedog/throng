import { describe, it, expect } from 'vitest';
import { fairColumnWidths } from '../../src/preview/table-widths.js';
import type { ColumnProfile } from '../../src/preview/table-widths.js';

/**
 * 047 T064 (core half) — `fairColumnWidths` (data-model.md "ColumnProfile / fair widths", research
 * R13, FR-060 – FR-062). Water-filling: every column gets `min(max-content, fair share)`, the
 * surplus from columns that need less than their share is redistributed to the rest, and no column
 * goes below `min(max, max(minLegible, min))` — a narrow column is never padded past its own content,
 * a wide one is never widened past its measured max-content. `overflow` is set, and every column kept
 * at its floor, when the floors alone exceed `available` (FR-062).
 */

const col = (min: number, max: number): ColumnProfile => ({ min, max });

describe('fairColumnWidths — everything fits at max-content', () => {
  it('gives every column exactly its max-content width when the total comfortably fits', () => {
    const cols = [col(20, 80), col(20, 120), col(20, 60)];
    const { widths, overflow } = fairColumnWidths(1000, cols, 40);
    expect(widths).toEqual([80, 120, 60]);
    expect(overflow).toBe(false);
  });

  it('a single column that fits takes its own max, not the whole available width', () => {
    const { widths, overflow } = fairColumnWidths(200, [col(10, 150)], 20);
    expect(widths).toEqual([150]);
    expect(overflow).toBe(false);
  });
});

describe('fairColumnWidths — one runaway column, capped at its share, surplus redistributed', () => {
  it('two comfortable columns take their max-content; the wide one gets the rest, well under its own max', () => {
    const cols = [col(20, 100), col(20, 100), col(20, 900)];
    const { widths, overflow } = fairColumnWidths(500, cols, 40);
    expect(widths).toEqual([100, 100, 300]);
    expect(overflow).toBe(false);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(500);
    // The runaway column is capped well below its own max-content.
    expect(widths[2]).toBeLessThan(cols[2].max);
  });

  it('redistributes surplus across MULTIPLE runaway columns evenly once the small ones are satisfied', () => {
    // One small column settles at its max (60); the remaining 440 splits evenly between the two
    // equally "runaway" columns (each wants 900), 220 apiece.
    const cols = [col(20, 60), col(20, 900), col(20, 900)];
    const { widths, overflow } = fairColumnWidths(500, cols, 40);
    expect(widths).toEqual([60, 220, 220]);
    expect(overflow).toBe(false);
  });
});

describe('fairColumnWidths — the floor (FR-061)', () => {
  it('never drops a column below max(minLegible, its own min-content)', () => {
    // minLegible (40) exceeds this column's own min (20): the floor is minLegible, not min.
    const cols = [col(20, 30), col(20, 500)];
    const { widths } = fairColumnWidths(300, cols, 40);
    // col 0's max-content (30) is BELOW minLegible (40) — R13: never padded past its own content, so
    // its floor collapses to its own max, not minLegible.
    expect(widths[0]).toBe(30);
  });

  it('a narrow column is never padded past its own max-content, even with width to spare', () => {
    const cols = [col(10, 25), col(10, 25)];
    const { widths, overflow } = fairColumnWidths(1000, cols, 200);
    // minLegible (200) exceeds both columns' max (25) — each is pinned to its own max, not stretched.
    expect(widths).toEqual([25, 25]);
    expect(overflow).toBe(false);
  });

  it('a wide column is never widened past its measured max-content', () => {
    const cols = [col(20, 40)];
    const { widths } = fairColumnWidths(10_000, cols, 20);
    expect(widths).toEqual([40]);
  });
});

describe('fairColumnWidths — overflow when minimums exceed available (FR-062)', () => {
  it('keeps every column at its floor, and reports overflow, when the floors alone do not fit', () => {
    const cols = [col(100, 300), col(100, 300), col(100, 300)];
    const { widths, overflow } = fairColumnWidths(250, cols, 100);
    expect(overflow).toBe(true);
    // Floors: max(minLegible, min) capped at max = min(300, max(100,100)) = 100 for each.
    expect(widths).toEqual([100, 100, 100]);
  });

  it('is exactly at the boundary — floors equal to available is NOT overflow', () => {
    const cols = [col(50, 300), col(50, 300)];
    const { overflow } = fairColumnWidths(100, cols, 50);
    expect(overflow).toBe(false);
  });

  it('one column above minLegible pushed there by its own min still counts toward the overflow floor', () => {
    const cols = [col(150, 300), col(20, 300)];
    // Floors: col0 = min(300, max(40,150)) = 150; col1 = min(300, max(40,20)) = 40. Sum 190 > 150.
    const { widths, overflow } = fairColumnWidths(150, cols, 40);
    expect(overflow).toBe(true);
    expect(widths).toEqual([150, 40]);
  });
});

describe('fairColumnWidths — edge shapes', () => {
  it('an empty column list is not an overflow and returns an empty width list', () => {
    expect(fairColumnWidths(500, [], 40)).toEqual({ widths: [], overflow: false });
  });

  it('every column exactly at its floor already sums to available leaves nothing to redistribute', () => {
    const cols = [col(50, 200), col(50, 200)];
    const { widths, overflow } = fairColumnWidths(100, cols, 50);
    expect(widths).toEqual([50, 50]);
    expect(overflow).toBe(false);
  });
});
