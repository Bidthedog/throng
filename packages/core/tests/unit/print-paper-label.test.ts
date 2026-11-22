/**
 * 075 FR-068b (the maintainer, 2026-11-20 18:10) — "For 'Paper size', show the size in mm next to each option,
 * depending on the orientation selected", and "When 'landscape' is selected, the example page for margins should
 * switch to landscape": both read the one paper table, `PAGE_SIZE_MM`, turned for the orientation.
 */
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_MM, PRINT_PAGE_SIZES, paperSizeLabel, paperSizeMm } from '../../src/index.js';

describe('the paper, turned for the orientation', () => {
  it('is the table\'s portrait size, and its width and height swapped in landscape', () => {
    for (const size of PRINT_PAGE_SIZES) {
      expect(paperSizeMm(size, 'portrait')).toEqual(PAGE_SIZE_MM[size]);
      expect(paperSizeMm(size, 'landscape')).toEqual({ width: PAGE_SIZE_MM[size].height, height: PAGE_SIZE_MM[size].width });
    }
  });

  it('labels each option with its size in millimetres, width first', () => {
    expect(paperSizeLabel('A4', 'portrait')).toBe('A4 (210 × 297 mm)');
    expect(paperSizeLabel('A4', 'landscape')).toBe('A4 (297 × 210 mm)');
    expect(paperSizeLabel('Letter', 'portrait')).toBe('Letter (215.9 × 279.4 mm)');
  });
});
