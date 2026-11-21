/**
 * Print… — the one command body (075 FR-061 – FR-064, contracts/print.md §Command).
 *
 * The chord, the header menu row and the body menu row all run {@link printPreviewPanel}: it asks the panel's
 * provider view for its printable output and hands that to main, which opens the single Print Preview window. It
 * never prints: only Print Preview's own Print button sends a job (FR-064, SC-012). A provider whose descriptor
 * declares no `print` cannot be printed, and every surface draws its row disabled with {@link PRINT_UNAVAILABLE}.
 */
import { logCaught, type PrintableOutput, type PrintJobRequest } from '@throng/core';
import type { PreviewProviderView, PrintableContext } from '../provider-view.js';
import { PRINT_NOT_READY, type PrintFailed } from '../../print/print-failure.js';
import type { DrawnPdfPage } from './pdf-printable.js';

/** Draws a PDF's pages, one image each; PDF.js in the app, loaded only when a provider prints ready-made pages. */
export type DrawPages = (pdf: Uint8Array) => Promise<readonly DrawnPdfPage[]>;

const drawWithPdfJs: DrawPages = async (pdf) => (await import('./pdf-printable.js')).drawPdfPages(pdf);

/**
 * 075 FR-060, FR-061, SC-011 — ready-made pages reach Print Preview as a document of the pages drawn, fitted whole,
 * one per sheet: the route the PDF preview already proves (FR-075c). Print Preview lays a document out (FR-066); a
 * PDF loaded into its host window, which runs no plugins, would lay out nothing.
 */
async function asDocument(output: PrintableOutput, title: string, drawPages: DrawPages): Promise<PrintableOutput> {
  if (output.kind !== 'pages') return output;
  const { pdfPrintHtml, paperOfPages } = await import('./pdf-printable.js');
  const pages = await drawPages(output.pdf);
  const paper = paperOfPages(pages); // FR-068g
  return { kind: 'document', html: pdfPrintHtml(pages, title), fit: 'page', remoteImages: [], ...(paper !== undefined ? { paper } : {}) };
}

/** The hover on a disabled Print… row (FR-062): what is wrong, not what the user may not do. */
export const PRINT_UNAVAILABLE = 'This preview type cannot be printed.';

/** The bridge call the command makes; `window.throng.print.open` in the app. */
export type PrintOpen = (request: PrintJobRequest) => Promise<{ opened: boolean; cause?: string }>;

export interface PrintTarget {
  readonly view: PreviewProviderView | undefined;
  /** The body as drawn now; `null` before it has drawn. */
  readonly body: HTMLElement | null;
  /** The previewed file's absolute path, whose name titles the job. */
  readonly filePath: string;
  /** 075 FR-075c — the file's bytes, for a provider that prints from them (a PDF). */
  readonly readSource?: PrintableContext['readSource'];
}

/** The file name a print job is titled with. */
export function printTitle(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/**
 * Open Print Preview for `target`. Resolves `false` when nothing could be printed (no `printable`, no body yet,
 * no bridge), `true` when main was asked — whether it opened a window or focused the one already open.
 */
export async function printPreviewPanel(
  target: PrintTarget,
  open: PrintOpen | undefined = window.throng?.print?.open,
  onFailed?: PrintFailed,
  drawPages: DrawPages = drawWithPdfJs,
): Promise<boolean> {
  const { view, body } = target;
  if (view?.printable === undefined || body === null || open === undefined) return false;
  const title = printTitle(target.filePath);
  try {
    const printable = await view.printable(body, { title, ...(target.readSource !== undefined ? { readSource: target.readSource } : {}) });
    const output = await asDocument(printable, title, drawPages);
    const result = await open({ title, output });
    if (result.cause !== undefined) {
      onFailed?.(title, result.cause); // FR-080 — main refused it, and said why
      return false;
    }
    return true;
  } catch (error) {
    logCaught('print: open Print Preview', error);
    onFailed?.(title, PRINT_NOT_READY);
    return false;
  }
}
