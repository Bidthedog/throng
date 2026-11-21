/**
 * The `throng.print` channels (075, contracts/print.md §IPC). Every payload from a renderer is checked here before
 * the controller sees it: a request must be a printable output this window could have built, and settings go
 * through core's own parse, so a malformed value takes its default rather than reaching the printer.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { parsePrintSettings, type PrintableOutput, type PrintJobRequest, type PrintSettings, type PrintSheet } from '@throng/core';
import type { PrintController } from './print-controller.js';

/** The largest printable document accepted, in characters or bytes. */
export const MAX_PRINTABLE_LENGTH = 64 * 1024 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A print request as a renderer sent it, or `null` when it is not one. */
export function asPrintRequest(raw: unknown): PrintJobRequest | null {
  if (!isObject(raw) || typeof raw.title !== 'string' || !isObject(raw.output)) return null;
  const o = raw.output;
  let output: PrintableOutput | null = null;
  if (o.kind === 'document' && typeof o.html === 'string' && o.html.length <= MAX_PRINTABLE_LENGTH && (o.fit === 'width' || o.fit === 'page')) {
    const remote = Array.isArray(o.remoteImages) ? o.remoteImages.filter((u): u is string => typeof u === 'string' && u.startsWith('https:')) : [];
    // FR-068g — the document's own page size, when it is one a sheet of paper can be (the sheet's own bounds).
    const mm = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 10 && v <= 2000;
    const paper = isObject(o.paper) && mm(o.paper.widthMm) && mm(o.paper.heightMm) ? { widthMm: o.paper.widthMm, heightMm: o.paper.heightMm } : undefined;
    output = { kind: 'document', html: o.html, fit: o.fit, remoteImages: remote, ...(paper !== undefined ? { paper } : {}) };
  } else if (o.kind === 'pages' && o.pdf instanceof Uint8Array && o.pdf.byteLength <= MAX_PRINTABLE_LENGTH) {
    output = { kind: 'pages', pdf: o.pdf };
  }
  return output === null ? null : { title: raw.title.slice(0, 260), output };
}

/** Why {@link asPrintRequest} refused `raw`, for the notice the requesting window raises (075 FR-080). */
export function printRefusal(raw: unknown): string {
  const o = isObject(raw) && isObject(raw.output) ? raw.output : null;
  const size = o === null ? 0 : typeof o.html === 'string' ? o.html.length : o.pdf instanceof Uint8Array ? o.pdf.byteLength : 0;
  return size > MAX_PRINTABLE_LENGTH ? 'The document is too large to print.' : 'It could not be made ready to print.';
}

/** The most pages, and the largest drawn page, a print sheet may carry. */
export const MAX_SHEET_PAGES = 5000;
export const MAX_SHEET_PAGE_LENGTH = 64 * 1024 * 1024;
const PNG_URL = 'data:image/png;base64,';

/** A print sheet as the Print Preview window sent it, or `null` when it is not one. */
export function asPrintSheet(raw: unknown): PrintSheet | null {
  if (!isObject(raw) || !Array.isArray(raw.pages) || raw.pages.length === 0 || raw.pages.length > MAX_SHEET_PAGES) return null;
  const { widthMm, heightMm } = raw;
  const size = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 10 && v <= 2000;
  if (!size(widthMm) || !size(heightMm)) return null;
  const pages = raw.pages.filter((p): p is string => typeof p === 'string' && p.startsWith(PNG_URL) && p.length <= MAX_SHEET_PAGE_LENGTH);
  return pages.length === raw.pages.length ? { widthMm, heightMm, pages } : null;
}

export function registerPrintIpc(controller: PrintController): void {
  /** Settings from the Print Preview window, validated against the printers its job last listed (no OS call). */
  const settingsOf = async (jobId: string, raw: unknown): Promise<PrintSettings | null> => {
    const printers = await controller.knownPrinters(jobId);
    if (printers === null) return null;
    const parsed = parsePrintSettings(raw, printers);
    const pages = isObject(raw) && isObject(raw.pages) && raw.pages.all === false && typeof raw.pages.ranges === 'string' ? { all: false as const, ranges: raw.pages.ranges.slice(0, 200) } : { all: true as const };
    return { ...parsed, pages };
  };

  ipcMain.handle('throng:print:open', async (event, raw: unknown) => {
    const request = asPrintRequest(raw);
    // 075 FR-080 — refused, and the window that asked is told why, in the user's words.
    if (request === null) return { opened: false, cause: printRefusal(raw) };
    return controller.open(BrowserWindow.fromWebContents(event.sender), request);
  });
  ipcMain.handle('throng:print:job', (_event, jobId: unknown) => (typeof jobId === 'string' ? controller.describe(jobId) : null));
  ipcMain.handle('throng:print:printers', (_event, jobId: unknown) => (typeof jobId === 'string' ? controller.printers(jobId) : null));
  ipcMain.handle('throng:print:render', async (_event, jobId: unknown, raw: unknown) => {
    if (typeof jobId !== 'string') return { error: 'No print job.' };
    const settings = await settingsOf(jobId, raw);
    return settings === null ? { error: 'This print job has closed.' } : controller.render(jobId, settings);
  });
  ipcMain.handle('throng:print:print', async (_event, jobId: unknown, raw: unknown, rawSheet: unknown) => {
    if (typeof jobId !== 'string') return { ok: false, cause: 'No print job.' };
    const sheet = asPrintSheet(rawSheet);
    if (sheet === null) return { ok: false, cause: 'The pages to print were not readable.' };
    const settings = await settingsOf(jobId, raw);
    return settings === null ? { ok: false, cause: 'This print job has closed.' } : controller.print(jobId, settings, sheet);
  });
  ipcMain.handle('throng:print:remember', async (_event, jobId: unknown, raw: unknown) => {
    if (typeof jobId !== 'string') return;
    const settings = await settingsOf(jobId, raw);
    if (settings !== null) controller.remember(jobId, settings);
  });
  ipcMain.handle('throng:print:close', async (_event, jobId: unknown, raw: unknown) => {
    if (typeof jobId !== 'string') return;
    const settings = await settingsOf(jobId, raw);
    if (settings !== null) controller.close(jobId, settings);
  });
}
