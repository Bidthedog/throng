/**
 * The `throng.print` channels (075, contracts/print.md §IPC). Every payload from a renderer is checked here before
 * the controller sees it: a request must be a printable output this window could have built, and settings go
 * through core's own parse, so a malformed value takes its default rather than reaching the printer.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { parsePrintSettings, type PrintableOutput, type PrintJobRequest, type PrintSettings } from '@throng/core';
import type { PageArea, PrintController } from './print-controller.js';

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
    output = { kind: 'document', html: o.html, fit: o.fit, remoteImages: remote };
  } else if (o.kind === 'pages' && o.pdf instanceof Uint8Array && o.pdf.byteLength <= MAX_PRINTABLE_LENGTH) {
    output = { kind: 'pages', pdf: o.pdf };
  }
  return output === null ? null : { title: raw.title.slice(0, 260), output };
}

function asArea(raw: unknown): PageArea | null {
  if (!isObject(raw)) return null;
  const n = (k: string): number | null => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : null);
  const [x, y, width, height] = [n('x'), n('y'), n('width'), n('height')];
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height };
}

export function registerPrintIpc(controller: PrintController): void {
  /** Settings from the Print Preview window, validated against the printers its job listed. */
  const settingsOf = async (jobId: string, raw: unknown): Promise<PrintSettings | null> => {
    const view = await controller.describe(jobId);
    if (view === null) return null;
    const parsed = parsePrintSettings(raw, view.printers);
    const pages = isObject(raw) && isObject(raw.pages) && raw.pages.all === false && typeof raw.pages.ranges === 'string' ? { all: false as const, ranges: raw.pages.ranges.slice(0, 200) } : { all: true as const };
    return { ...parsed, pages };
  };

  ipcMain.handle('throng:print:open', async (event, raw: unknown) => {
    const request = asPrintRequest(raw);
    if (request === null) return { opened: false };
    return controller.open(BrowserWindow.fromWebContents(event.sender), request);
  });
  ipcMain.handle('throng:print:job', (_event, jobId: unknown) => (typeof jobId === 'string' ? controller.describe(jobId) : null));
  ipcMain.handle('throng:print:render', async (_event, jobId: unknown, raw: unknown) => {
    if (typeof jobId !== 'string') return { error: 'No print job.' };
    const settings = await settingsOf(jobId, raw);
    return settings === null ? { error: 'This print job has closed.' } : controller.render(jobId, settings);
  });
  ipcMain.handle('throng:print:setPageArea', (_event, jobId: unknown, raw: unknown) => {
    const area = asArea(raw);
    if (typeof jobId === 'string' && area !== null) controller.setPageArea(jobId, area);
  });
  ipcMain.handle('throng:print:print', async (_event, jobId: unknown, raw: unknown) => {
    if (typeof jobId !== 'string') return { ok: false, cause: 'No print job.' };
    const settings = await settingsOf(jobId, raw);
    return settings === null ? { ok: false, cause: 'This print job has closed.' } : controller.print(jobId, settings);
  });
  ipcMain.handle('throng:print:close', async (_event, jobId: unknown, raw: unknown) => {
    if (typeof jobId !== 'string') return;
    const settings = await settingsOf(jobId, raw);
    if (settings !== null) controller.close(jobId, settings);
  });
}
