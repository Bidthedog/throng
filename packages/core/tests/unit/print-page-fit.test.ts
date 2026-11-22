/**
 * How a page-shaped printable — a picture, an SVG, a diagram on its own, a PDF's pages — meets its sheet (maintainer,
 * 2026-11-22: a "Fit" drop-down replacing "Fit to page": Fit to page, Stretch to fit (keep proportions), Stretch to fill
 * (distorts), Fill page (crop), Actual size and Scale). A flowing document keeps Fit to page width or Scale.
 *
 * Each choice is a stylesheet the print host lays the printable out under (`pageFitCss`), as Centre is. Scale on a
 * page-shaped printable is that stylesheet too, never `printToPDF`'s page scale: a PDF page is laid out at the
 * viewport's height, which the page scale changes with it, so a PDF never took the scale chosen (maintainer,
 * 2026-11-22: "The 'Scale' option does not seem to work very well for PDFs").
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, PRINT_PAGE_FITS, parsePrintSettings, toPdfOptions, type PrintSettings } from '../../src/index.js';

const PRINTERS = [{ name: 'home', isDefault: true }];
const withScale = (scale: Partial<PrintSettings['scale']>): PrintSettings => ({ ...DEFAULT_PRINT_SETTINGS, scale: { ...DEFAULT_PRINT_SETTINGS.scale, ...scale } });

describe('the Fit choice for a page-shaped printable', () => {
  it('offers the six, Fit to page first and by default', () => {
    expect(PRINT_PAGE_FITS.map((f) => f.label)).toEqual([
      'Fit to page',
      'Stretch to fit (keep proportions)',
      'Stretch to fill (distorts)',
      'Fill page (crop)',
      'Actual size',
      'Scale',
    ]);
    expect(DEFAULT_PRINT_SETTINGS.scale.pageFit).toBe('fit');
  });

  it('is kept apart from a document’s, and a settings file from before it keeps what it chose', () => {
    expect(parsePrintSettings({ scale: { fitWidth: true, pageFit: 'crop', percent: 100 } }, PRINTERS).scale).toEqual({ fitWidth: true, pageFit: 'crop', percent: 100 });
    expect(parsePrintSettings({ scale: { fitWidth: false, percent: 80 } }, PRINTERS).scale.pageFit).toBe('scale');
    expect(parsePrintSettings({ scale: { fitWidth: true, percent: 80 } }, PRINTERS).scale.pageFit).toBe('fit');
    expect(parsePrintSettings({ scale: { fitWidth: true, pageFit: 'zoom', percent: 80 } }, PRINTERS).scale.pageFit).toBe('fit');
  });

  it('never scales the page itself: every choice, Scale included, is the printable’s own stylesheet', () => {
    for (const { id } of PRINT_PAGE_FITS) {
      const o = toPdfOptions(withScale({ pageFit: id, percent: 150, fitWidth: false }), undefined, 'page');
      expect(o.scale, id).toBe(1);
      expect(o.pageFitCss, id).toEqual(expect.any(String));
      expect(o.naturalDiagrams, id).toBe(false);
    }
  });

  it('draws each choice its own way', () => {
    const css = (pageFit: (typeof PRINT_PAGE_FITS)[number]['id'], percent = 100): string =>
      toPdfOptions(withScale({ pageFit, percent }), undefined, 'page').pageFitCss!;
    // Fit to page never enlarges past the picture's own width; Stretch to fit drops that bound.
    expect(css('fit')).toContain('var(--throng-print-cap');
    expect(css('stretch')).not.toContain('var(--throng-print-cap');
    // Stretch to fill sets both sides, so the shape gives way.
    expect(css('fill')).toMatch(/aspect-ratio:auto/);
    // Fill page covers the area and clips what overflows it.
    expect(css('crop')).toMatch(/max\(100%/);
    expect(css('crop')).toContain('overflow:hidden');
    // Actual size and Scale lay it out at its own width, Scale times the percentage.
    expect(css('actual')).toContain('width:var(--throng-print-natural-width');
    expect(css('scale', 150)).toContain('calc(var(--throng-print-natural-width) * 1.5)');
  });
});

describe('a flowing document', () => {
  it('fits the page width, or scales the page by the percentage, and takes no page-fit stylesheet', () => {
    expect(toPdfOptions(withScale({ fitWidth: true, percent: 150 }), undefined, 'width')).toMatchObject({ scale: 1, naturalDiagrams: false });
    const scaled = toPdfOptions(withScale({ fitWidth: false, percent: 150, pageFit: 'crop' }), undefined, 'width');
    expect(scaled).toMatchObject({ scale: 1.5, naturalDiagrams: true });
    expect(scaled.pageFitCss).toBeUndefined();
  });
});
