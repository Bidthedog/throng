/**
 * 075 FR-068g (the maintainer, 2026-11-21 11:24: "A PDF's own page size should choose the print paper size.") — the
 * paper Print Preview starts at for a document with its own page size, and how a size none of the listed ones match
 * reaches Electron.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, paperForPage, paperSizeLabel, paperOf, toPdfOptions, toPrintOptions, type PrintSettings } from '../../src/preview/print.js';

describe('paperForPage (FR-068g)', () => {
  it('picks the listed size the page is, turned the way the page is', () => {
    expect(paperForPage(210, 297)).toEqual({ pageSize: 'A4', orientation: 'portrait' });
    expect(paperForPage(297, 210)).toEqual({ pageSize: 'A4', orientation: 'landscape' });
    expect(paperForPage(215.9, 279.4)).toEqual({ pageSize: 'Letter', orientation: 'portrait' });
  });

  it("matches a size to within a millimetre, as a PDF's points round it (595 × 842 pt is A4)", () => {
    expect(paperForPage((595 / 72) * 25.4, (842 / 72) * 25.4)).toEqual({ pageSize: 'A4', orientation: 'portrait' });
  });

  it('is a custom paper, kept portrait and turned by orientation, when no listed size matches', () => {
    expect(paperForPage(100, 150)).toEqual({ pageSize: 'Custom', orientation: 'portrait', customPaper: { width: 100, height: 150 } });
    expect(paperForPage(200, 100)).toEqual({ pageSize: 'Custom', orientation: 'landscape', customPaper: { width: 100, height: 200 } });
  });
});

describe('a custom paper, from settings to Electron', () => {
  const custom: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, printer: 'p', pageSize: 'Custom', orientation: 'landscape', customPaper: { width: 100, height: 150 } };

  it('has its own size, turned, and its own label', () => {
    expect(paperOf(custom)).toEqual({ width: 150, height: 100 });
    expect(paperSizeLabel('Custom', 'portrait', { width: 100, height: 150 })).toBe('Custom (100 × 150 mm)');
  });

  it('lays out at that size, in inches, turned by the landscape flag as a named size is', () => {
    expect(toPdfOptions(custom).pageSize).toEqual({ width: 100 / 25.4, height: 150 / 25.4 });
    expect(toPdfOptions(custom).landscape).toBe(true);
  });

  it('prints at that size, in microns', () => {
    expect(toPrintOptions(custom)?.pageSize).toEqual({ width: 100_000, height: 150_000 });
  });
});
