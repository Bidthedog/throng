/**
 * Print Preview's one door to PDF.js (075 FR-068a).
 *
 * Main lays the job out as a PDF once per settings change and hands the window its bytes; this draws one page of
 * it at a time onto a canvas, fitted whole to a box. Stepping between pages therefore lays nothing out again, and
 * a page is shown only once it is fully drawn — the canvas is the caller's to put on screen when this resolves.
 *
 * PDF.js (`pdfjs-dist`, Apache-2.0) is reached only through the PDF Preview's own loader (`preview/pdf-library.ts`),
 * so no other window loads it, and it is given what 074's PDF previews give it (`providers/pdf/pdf-renderer.ts`): the bytes as `data`, no URL of
 * any kind, `useWasm: false` (the renderer CSP grants no `wasm-unsafe-eval`), no XFA, and one module worker for
 * the window's life. The PDF is throng's own, laid out from the printable document, but nothing in it runs or
 * fetches regardless.
 */

/** One laid-out job's pages. */
export interface PrintPages {
  readonly pageCount: number;
  /**
   * Draw page `n` (1-based) into `canvas`, as large as fits whole in `box` (CSS px), at `pixelRatio` device px per
   * CSS px. Resolves with the page's CSS size once it is fully drawn, and the paper's size in millimetres.
   */
  draw(
    n: number,
    canvas: HTMLCanvasElement,
    box: { width: number; height: number },
    pixelRatio: number,
  ): Promise<{ width: number; height: number; widthMm: number; heightMm: number }>;
  /**
   * Every page, drawn whole at {@link PRINT_DPI} for the printer (2026-11-20): the printer is sent these, so the
   * paper is the preview — the range, margins, scale and page breaks — and nothing is laid out again.
   */
  sheet(): Promise<PrintSheet>;
  destroy(): void;
}

/** How finely a page is drawn for the printer: a laser printer's own resolution. */
export const PRINT_DPI = 300;
const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

import { PRINT_PALETTE, type PrintSheet } from '@throng/core';
import { loadPdfJs } from '../preview/pdf-library.js';

/** The scale at which a `width` × `height` page fits whole in `box`. */
export function fitScale(width: number, height: number, box: { width: number; height: number }): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.max(0.01, Math.min(box.width / width, box.height / height));
}

/** Open a laid-out job's PDF. Rejects when PDF.js cannot read it. */
export async function openPrintPages(bytes: Uint8Array): Promise<PrintPages> {
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
  const proxy = await task.promise;
  return {
    pageCount: proxy.numPages,
    async draw(n, canvas, box, pixelRatio) {
      const page = await proxy.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = fitScale(base.width, base.height, box);
      const viewport = page.getViewport({ scale: scale * pixelRatio });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: PRINT_PALETTE.editorBg }).promise;
      return {
        width: Math.floor(base.width * scale),
        height: Math.floor(base.height * scale),
        widthMm: (base.width / POINTS_PER_INCH) * MM_PER_INCH,
        heightMm: (base.height / POINTS_PER_INCH) * MM_PER_INCH,
      };
    },
    async sheet() {
      const pages: string[] = [];
      let size = { widthMm: 210, heightMm: 297 };
      const canvas = document.createElement('canvas');
      for (let n = 1; n <= proxy.numPages; n++) {
        const page = await proxy.getPage(n);
        const base = page.getViewport({ scale: 1 });
        if (n === 1) size = { widthMm: (base.width / POINTS_PER_INCH) * MM_PER_INCH, heightMm: (base.height / POINTS_PER_INCH) * MM_PER_INCH };
        const viewport = page.getViewport({ scale: PRINT_DPI / POINTS_PER_INCH });
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({ canvas, viewport, background: PRINT_PALETTE.editorBg }).promise;
        pages.push(canvas.toDataURL('image/png'));
        page.cleanup();
      }
      canvas.width = 0;
      canvas.height = 0;
      return { ...size, pages };
    },
    destroy() {
      void task.destroy();
    },
  };
}
