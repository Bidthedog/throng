/**
 * 075 FR-075c (the maintainer, 2026-11-20: "Add support for printing to PDFs") — a PDF preview prints its own pages,
 * one per sheet of paper, each fitted whole: drawn with PDF.js and handed to Print Preview as a document of pages.
 *
 * Layer: component — the document is DOM (jsdom); PDF.js and the canvas are stood in for, since jsdom draws nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakePdf = vi.hoisted(() => ({
  pages: [
    { width: 612, height: 792 },
    { width: 842, height: 595 },
  ],
  destroyed: 0,
  rendered: [] as number[],
}));

vi.mock('../../src/renderer/preview/pdf-library.js', () => ({
  loadPdfJs: () =>
    Promise.resolve({
      worker: {},
      lib: {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: fakePdf.pages.length,
            getPage: (n: number) =>
              Promise.resolve({
                getViewport: ({ scale }: { scale: number }) => ({ width: fakePdf.pages[n - 1]!.width * scale, height: fakePdf.pages[n - 1]!.height * scale }),
                render: () => {
                  fakePdf.rendered.push(n);
                  return { promise: Promise.resolve() };
                },
                cleanup: () => {},
              }),
          }),
          destroy: () => {
            fakePdf.destroyed++;
            return Promise.resolve();
          },
        }),
      },
    }),
}));

import { PDF_PRINT_DPI, PDF_PRINT_HTML_BASE, PDF_PRINT_PAGE_MARKUP, buildPdfPrintable, drawPdfPages, pdfPrintHtml } from '../../src/renderer/preview/print/pdf-printable.js';
import { PrintTooLarge } from '../../src/renderer/print/print-failure.js';

beforeEach(() => {
  fakePdf.pages = [
    { width: 612, height: 792 },
    { width: 842, height: 595 },
  ];
  fakePdf.rendered = [];
  fakePdf.destroyed = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    return `data:image/png;base64,${this.width}x${this.height}`;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('the PDF\'s printable document', () => {
  it('puts each page on its own sheet, fitted whole, its shape kept', () => {
    const doc = parse(
      pdfPrintHtml(
        [
          { src: 'data:image/png;base64,AA', widthPt: 612, heightPt: 792 },
          { src: 'data:image/png;base64,BB', widthPt: 842, heightPt: 595 },
        ],
        'report.pdf',
      ),
    );
    const sheets = doc.querySelectorAll('.throng-print__pdf-page');
    expect(sheets).toHaveLength(2);
    expect([...doc.querySelectorAll('img')].map((i) => [i.getAttribute('src'), i.getAttribute('alt'), i.getAttribute('width'), i.getAttribute('height')])).toEqual([
      ['data:image/png;base64,AA', 'Page 1', '612', '792'],
      ['data:image/png;base64,BB', 'Page 2', '842', '595'],
    ]);
    const style = doc.querySelector('style')!.textContent!;
    expect(style).toMatch(/\.throng-print__pdf-page \{[^}]*break-after: page/);
    expect(style).toMatch(/\.throng-print__pdf-page img \{[^}]*max-width: 100%; max-height: 100%/);
    // No @page: the paper, margins and scale are Print Preview's.
    expect(style).not.toContain('@page');
  });

  it('runs nothing and requests nothing: its pages are data', () => {
    const html = pdfPrintHtml([{ src: 'data:image/png;base64,AA', widthPt: 1, heightPt: 1 }], 'x.pdf');
    expect(html).toContain("default-src 'none'; img-src data:");
    expect(parse(html).querySelector('script')).toBeNull();
  });
});

describe('Print… on a PDF preview', () => {
  it('draws every page from the file\'s own bytes, at the print resolution', async () => {
    const readSource = vi.fn(() => Promise.resolve({ ok: true as const, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }));
    const output = await buildPdfPrintable(readSource, 'report.pdf');
    expect(readSource).toHaveBeenCalledTimes(1);
    expect(fakePdf.rendered).toEqual([1, 2]);
    expect(fakePdf.destroyed).toBe(1);
    if (output.kind !== 'document') throw new Error('not a document');
    expect(output.fit).toBe('page');
    const scale = PDF_PRINT_DPI / 72;
    expect([...parse(output.html).querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      `data:image/png;base64,${Math.round(612 * scale)}x${Math.round(792 * scale)}`,
      `data:image/png;base64,${Math.round(842 * scale)}x${Math.round(595 * scale)}`,
    ]);
  });

  // Maintainer, 2026-11-22 — a 400-page PDF drew all 400 pages (247.5 MB, 11 s) before main refused it as too large.
  it('stops drawing at the first page that passes what a print holds, naming how many fit', async () => {
    fakePdf.pages = [
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ];
    const one = `data:image/png;base64,${Math.round((612 * PDF_PRINT_DPI) / 72)}x${Math.round((792 * PDF_PRINT_DPI) / 72)}`.length;
    const limit = PDF_PRINT_HTML_BASE + 2 * (one + PDF_PRINT_PAGE_MARKUP);
    const refused = drawPdfPages(new Uint8Array([1]), limit);
    await expect(refused).rejects.toBeInstanceOf(PrintTooLarge);
    await expect(refused).rejects.toMatchObject({ fitting: 2, total: 3 });
    // The third page was drawn and found too much; nothing after it would have been.
    expect(fakePdf.rendered).toEqual([1, 2, 3]);
    expect(fakePdf.destroyed).toBe(1);
  });

  it('never counts the document shorter than it is, so main does not refuse what the drawing admitted', () => {
    const pages = Array.from({ length: 50 }, (_, i) => ({ src: `data:image/png;base64,${'A'.repeat(i * 37)}`, widthPt: 612.4, heightPt: 791.6 }));
    const title = '"<&>\''.repeat(52); // 260 characters, every one escaped
    const counted = PDF_PRINT_HTML_BASE + pages.reduce((n, p) => n + p.src.length + PDF_PRINT_PAGE_MARKUP, 0);
    expect(pdfPrintHtml(pages, title).length).toBeLessThanOrEqual(counted);
  });

  it('refuses, and opens nothing, when the file cannot be read', async () => {
    await expect(buildPdfPrintable(() => Promise.resolve({ ok: false, status: 413 }), 'big.pdf')).rejects.toThrow(/could not be read.*413/);
    await expect(buildPdfPrintable(undefined, 'x.pdf')).rejects.toThrow(/cannot be read/);
  });
});

// The Fit choice (maintainer, 2026-11-22): each page carries its own size and shape for printPageFitCss.
describe('a PDF page printed under a Fit choice', () => {
  it('carries its own width in CSS pixels and its shape', async () => {
    const { pdfPrintHtml } = await import('../../src/renderer/preview/print/pdf-printable.js');
    const html = pdfPrintHtml([{ src: 'data:image/png;base64,AA==', widthPt: 612, heightPt: 792 }], 'p.pdf');
    expect(html).toContain('--throng-print-natural-width:816.00px');
    expect(html).toContain('--throng-print-ratio:0.772727');
  });
});
