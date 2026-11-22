/**
 * 074 R5 (FR-065), 075 FR-068a — PDF.js (`pdfjs-dist`, Apache-2.0), loaded once per window, behind this module's
 * dynamic import only, so no window and no preview loads it with the app (the `pdf` chunk, `vite.config.ts`). The PDF
 * Preview's body (`providers/pdf/pdf-renderer.ts`) and Print Preview's pages (`print-preview/print-pages.ts`) both
 * open documents through it.
 */

type PdfJs = typeof import('pdfjs-dist');

/** The library, and the window's one worker every document is handed. */
export interface PdfLibrary {
  lib: PdfJs;
  worker: InstanceType<PdfJs['PDFWorker']>;
}

let library: Promise<PdfLibrary> | null = null;

/**
 * PDF.js, loaded once, with ONE worker for the window's life: a same-origin module script (`script-src 'self'`).
 *
 * The worker is handed to every document (`getDocument({ worker })`), never left to PDF.js's port cache. A document
 * that creates its own from the port destroys that shared worker when it is destroyed — so a second PDF opened while
 * the first was closing failed with "the worker is being destroyed", leaving the panel on the first, and closing one
 * PDF broke every other PDF still open (measured 2026-11-19). A document given a worker ends only its own document.
 * A failed load is not kept.
 */
export function loadPdfJs(): Promise<PdfLibrary> {
  library ??= import('pdfjs-dist')
    .then((lib) => {
      const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
      return { lib, worker: lib.PDFWorker.create({ port }) };
    })
    .catch((error: unknown) => {
      library = null;
      throw error;
    });
  return library;
}
