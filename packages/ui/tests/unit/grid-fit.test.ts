/**
 * 073 FR-011, FR-012 — the grid's pure fit arithmetic: a column's fitted width and a row's wrapped line count.
 * Layer: unit — both are arithmetic over an injected `measure`, so no canvas or DOM is needed; the component
 * test proves only that the grid wires the result to the pointer and to `onColumnWidthChange`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CELL_PADDING_X,
  EXPANDED_MAX_LINES,
  fitColumnWidth,
  wrappedLineCount,
} from '../../src/renderer/grid/fit.js';

/** One CSS pixel per character: every expectation below is countable by hand. */
const measure = (text: string): number => text.length;

describe('fitColumnWidth (FR-011)', () => {
  it('is the widest value over every row plus the cell padding', () => {
    const values = ['a', 'x'.repeat(60), 'abc'];
    const width = fitColumnWidth({ count: values.length, textAt: (i) => values[i] ?? '', header: 'x', measure });
    expect(width).toBe(60 + CELL_PADDING_X);
  });

  it('counts the header label when it is the widest', () => {
    const header = 'a rather long header label that is wider than forty';
    const width = fitColumnWidth({ count: 1, textAt: () => 'ab', header, measure });
    expect(width).toBe(header.length + CELL_PADDING_X);
  });

  it('clamps to 40 at the narrow end and 2000 at the wide end', () => {
    expect(fitColumnWidth({ count: 1, textAt: () => '', header: 'A', measure })).toBe(40);
    expect(fitColumnWidth({ count: 1, textAt: () => 'x'.repeat(5000), header: 'A', measure })).toBe(2000);
  });

  it('reports the width at zoom 1 whatever the zoom the text was measured at', () => {
    // Measured at zoom 2 the text is twice as wide; the stored width is still the zoom-1 width.
    const doubled = (text: string): number => text.length * 2;
    const width = fitColumnWidth({ count: 1, textAt: () => 'x'.repeat(50), header: 'A', measure: doubled, zoom: 2 });
    expect(width).toBe(50 + CELL_PADDING_X);
  });

  it('skips empty values, so 100,000 rows stay cheap', () => {
    const spy = vi.fn(measure);
    fitColumnWidth({ count: 100_000, textAt: (i) => (i % 2 === 0 ? '' : 'abc'), header: 'A', measure: spy });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(50_001);
  });
});

describe('wrappedLineCount (FR-012)', () => {
  it('is 1 for text that fits and for the empty value', () => {
    expect(wrappedLineCount('hello', 10, measure)).toBe(1);
    expect(wrappedLineCount('', 10, measure)).toBe(1);
  });

  it('honours line breaks of every kind', () => {
    expect(wrappedLineCount('a\nb\r\nc\rd', 10, measure)).toBe(4);
    expect(wrappedLineCount('a\n\nb', 10, measure)).toBe(3);
  });

  it('wraps at spaces to the width', () => {
    expect(wrappedLineCount('aaaa bbbb cccc', 9, measure)).toBe(2);
    expect(wrappedLineCount('aaaa bbbb cccc', 5, measure)).toBe(3);
  });

  it('breaks a word wider than the column across lines', () => {
    expect(wrappedLineCount('abcdefghij', 4, measure)).toBe(3);
  });

  it('stops counting at the cap', () => {
    const many = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    expect(wrappedLineCount(many, 50, measure)).toBe(EXPANDED_MAX_LINES);
    expect(EXPANDED_MAX_LINES).toBe(20);
  });
});
