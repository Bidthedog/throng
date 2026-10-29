import { describe, it, expect } from 'vitest';
import { STYLED_LINE_SAMPLE, styledLineCount, type StyledLineBuffer } from '../../../src/renderer/terminal/styled-lines.js';

/** A buffer of `lines` lines of `cols` cells, where `styled(y, x)` says whether that cell carries an attribute. */
function buffer(lines: number, cols: number, styled: (y: number, x: number) => boolean): StyledLineBuffer & { reads: number } {
  const b = {
    reads: 0,
    length: lines,
    getLine: (y: number) =>
      y < 0 || y >= lines
        ? undefined
        : {
            length: cols,
            getCell: (x: number) => {
              b.reads += 1;
              return { isAttributeDefault: () => !styled(y, x) };
            },
          },
  };
  return b;
}

describe('styled terminal lines (055 FR-024b, research R9)', () => {
  it('a buffer of plain text has no styled lines', () => {
    expect(styledLineCount(buffer(1_000, 80, () => false))).toBe(0);
  });

  it('a line is styled when any one of its cells carries an attribute, wherever it is', () => {
    expect(styledLineCount(buffer(10, 80, (_y, x) => x === 79))).toBe(10);
  });

  it('counts exactly while the buffer is no longer than the sample', () => {
    expect(styledLineCount(buffer(STYLED_LINE_SAMPLE, 80, (y) => y % 4 === 0))).toBe(STYLED_LINE_SAMPLE / 4);
  });

  it("scales a sample of a long buffer's lines to the whole of it", () => {
    const count = styledLineCount(buffer(10_000, 80, (y) => y % 2 === 0));
    expect(count).toBeGreaterThan(4_500);
    expect(count).toBeLessThan(5_500);
  });

  it('reads only the sample, however long the buffer: no more than the sampled lines × their cells', () => {
    const b = buffer(100_000, 80, () => false);
    styledLineCount(b);
    expect(b.reads).toBeLessThanOrEqual(STYLED_LINE_SAMPLE * 80);
  });

  it('an empty buffer has none', () => {
    expect(styledLineCount(buffer(0, 80, () => true))).toBe(0);
  });
});
