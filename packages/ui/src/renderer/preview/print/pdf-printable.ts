/**
 * Printing a PDF preview (075 FR-075c; the maintainer, 2026-11-20: "Add support for printing to PDFs").
 *
 * A PDF prints its OWN pages, one per sheet of paper, each fitted whole inside the page's margins with its shape
 * kept. Print Preview lays every printable out as a document (FR-066), so the PDF's pages are drawn with PDF.js — the
 * library the preview and Print Preview already load — and handed over as a document of page images: the same proven
 * path as every other preview, rather than a second layout path for ready-made pages.
 *
 * Each page is drawn at {@link PDF_PRINT_DPI}: Print Preview draws the sheet again for the printer at 300 DPI
 * (`print-pages.ts`), and 150 keeps a long PDF's printable to a fraction of that size while staying sharper than any
 * screen it is previewed on.
 *
 * Pure apart from {@link drawPdfPages}: {@link pdfPrintHtml} builds the document from drawn pages, so its rules are
 * tested without a canvas.
 */
import { PRINT_DOCUMENT_MAX_LENGTH, PRINT_PALETTE, type PrintableOutput } from '@throng/core';
import { PrintTooLarge } from '../../print/print-failure.js';
import { loadPdfJs } from '../pdf-library.js';
import { escapeHtml } from '@throng/core';

/** How finely a PDF's page is drawn for printing. */
export const PDF_PRINT_DPI = 150;
const POINTS_PER_INCH = 72;

/** One page, drawn. */
export interface DrawnPdfPage {
  /** A `data:image/png` URL. */
  readonly src: string;
  /** The page's own size, in points. */
  readonly widthPt: number;
  readonly heightPt: number;
}


// No `@page`: the paper, margins and scale are Print Preview's (FR-066). Each page image is one sheet, fitted whole.
const STYLE = `
html, body { margin: 0; padding: 0; background: ${PRINT_PALETTE.surface}; }
.throng-print__pdf-page { display: flex; justify-content: flex-start; align-items: flex-start; height: 99vh;
  break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid; }
.throng-print__pdf-page:last-child { break-after: auto; page-break-after: auto; }
.throng-print__pdf-page img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; }
`;

/** The document that prints `pages`, one per sheet. */
export function pdfPrintHtml(pages: readonly DrawnPdfPage[], title: string): string {
  const body = pages
    .map((p, i) => `<div class="throng-print__pdf-page"><img src="${p.src}" alt="Page ${i + 1}" width="${Math.round(p.widthPt)}" height="${Math.round(p.heightPt)}" style="--throng-print-natural-width:${((p.widthPt * 4) / 3).toFixed(2)}px;--throng-print-ratio:${(p.widthPt / p.heightPt).toFixed(6)}"></div>`)
    .join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    `</head><body class="throng-print throng-print--pdf">${body}</body></html>`,
  ].join('');
}

/** What {@link pdfPrintHtml} adds around the pages, at most: the head, the style and a title of 260 characters escaped. */
export const PDF_PRINT_HTML_BASE = 2048;
/** What it adds around one page's image, at most, its Fit size and shape included. */
export const PDF_PRINT_PAGE_MARKUP = 256;

/**
 * Draw every page of the PDF in `bytes`. Rejects when PDF.js cannot read it, and with {@link PrintTooLarge} at the
 * first page whose drawing makes the print document longer than `limit` characters.
 */
export async function drawPdfPages(bytes: Uint8Array, limit = PRINT_DOCUMENT_MAX_LENGTH): Promise<DrawnPdfPage[]> {
  const { lib, worker } = await loadPdfJs();
  const task = lib.getDocument({
    worker,
    // A copy: PDF.js transfers the buffer it is given to its worker.
    data: bytes.slice(),
    enableXfa: false,
    useWasm: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
  });
  const canvas = document.createElement('canvas');
  try {
    const proxy = await task.promise;
    const pages: DrawnPdfPage[] = [];
    let length = PDF_PRINT_HTML_BASE;
    for (let n = 1; n <= proxy.numPages; n++) {
      const page = await proxy.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_PRINT_DPI / POINTS_PER_INCH });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, viewport, background: PRINT_PALETTE.surface }).promise;
      const src = canvas.toDataURL('image/png');
      length += src.length + PDF_PRINT_PAGE_MARKUP;
      if (length > limit) throw new PrintTooLarge(pages.length, proxy.numPages);
      pages.push({ src, widthPt: base.width, heightPt: base.height });
      page.cleanup();
    }
    return pages;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    void task.destroy();
  }
}

/** FR-068g — the paper a PDF's first page is, in millimetres: Print Preview starts on it. */
export function paperOfPages(pages: readonly DrawnPdfPage[]): { widthMm: number; heightMm: number } | undefined {
  const first = pages[0];
  if (first === undefined) return undefined;
  const mm = (pt: number): number => (pt / POINTS_PER_INCH) * 25.4;
  return { widthMm: mm(first.widthPt), heightMm: mm(first.heightPt) };
}

/** The PDF view's `printable`: the file's own pages, read through the source route. */
export async function buildPdfPrintable(
  readSource: (() => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number }>) | undefined,
  title: string,
): Promise<PrintableOutput> {
  if (readSource === undefined) throw new Error('The PDF cannot be read for printing.');
  const answer = await readSource();
  if (!answer.ok) throw new Error(`The PDF could not be read for printing (${answer.status}).`);
  const pages = await drawPdfPages(answer.bytes);
  const paper = paperOfPages(pages);
  return { kind: 'document', html: pdfPrintHtml(pages, title), fit: 'page', remoteImages: [], ...(paper !== undefined ? { paper } : {}) };
}
