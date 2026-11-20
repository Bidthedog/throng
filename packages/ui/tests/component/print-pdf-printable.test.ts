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

import { PDF_PRINT_DPI, buildPdfPrintable, pdfPrintHtml } from '../../src/renderer/preview/print/pdf-printable.js';

beforeEach(() => {
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

  it('refuses, and opens nothing, when the file cannot be read', async () => {
    await expect(buildPdfPrintable(() => Promise.resolve({ ok: false, status: 413 }), 'big.pdf')).rejects.toThrow(/could not be read.*413/);
    await expect(buildPdfPrintable(undefined, 'x.pdf')).rejects.toThrow(/cannot be read/);
  });
});
