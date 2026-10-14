/**
 * The renderer's route to the OS clipboard (016, FR-013a/FR-015c).
 *
 * The sandboxed renderer cannot reach the OS clipboard, and must not: the clipboard is an OS
 * resource, so it lives behind the {@link IClipboard} seam in UI main (Principle II). The renderer
 * says what it wants copied and what SHAPE it is; main writes it and remembers.
 *
 * The shape is remembered app-globally, in ONE record, which is what makes the feature's primary
 * use case work — cut a column block in one file, paste it into another, in a different window. A
 * per-view marker would have broken exactly that, silently.
 */
import { ipcMain } from 'electron';
import type { ClipboardMode } from '@throng/core';
import type { ClipboardService } from './clipboard-service.js';

const MODES: readonly ClipboardMode[] = ['verbatim', 'full-line', 'rectangular'];

const asMode = (raw: unknown): ClipboardMode =>
  MODES.includes(raw as ClipboardMode) ? (raw as ClipboardMode) : 'verbatim';

/** 054 — what Copy Diagram as Image may hand over: a base64 PNG data URI, and nothing else. */
const PNG_DATA_URI = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

/** The largest image accepted, as data-URI characters (~48 MB of PNG). A diagram is far smaller. */
export const MAX_CLIPBOARD_IMAGE_URI_LENGTH = 64 * 1024 * 1024;

export function registerClipboardIpc(clipboard: ClipboardService): void {
  ipcMain.handle('throng:clipboard:write', async (_event, raw: Record<string, unknown>) => {
    if (typeof raw?.text !== 'string') return;
    await clipboard.write(raw.text, asMode(raw.mode));
  });

  /** A preview panel's rich copy (044 FR-035a) — plain text and sanitised HTML in one write. */
  ipcMain.handle('throng:clipboard:writeRich', async (_event, raw: Record<string, unknown>) => {
    if (typeof raw?.text !== 'string' || typeof raw?.html !== 'string') return;
    await clipboard.writeRich({ text: raw.text, html: raw.html });
  });

  /**
   * 054 — Copy Diagram as Image: a PNG data URI from the renderer's rasteriser. Anything that is not a
   * bounded base64 PNG URI is ignored; the HTML alternative is built HERE, from the validated URI, so the
   * renderer never supplies markup for the clipboard.
   */
  ipcMain.handle('throng:clipboard:writeImage', async (_event, raw: Record<string, unknown>) => {
    const uri = raw?.dataUri;
    if (typeof uri !== 'string' || uri.length > MAX_CLIPBOARD_IMAGE_URI_LENGTH) return;
    const match = PNG_DATA_URI.exec(uri);
    if (match === null) return;
    await clipboard.writeImage({ png: new Uint8Array(Buffer.from(match[1]!, 'base64')), html: `<img src="${uri}">` });
  });

  /**
   * What a paste should insert, and how.
   *
   * The mode is decided HERE, against the live OS clipboard, rather than handed out earlier and
   * cached: if any other application has written to the clipboard since throng last did, throng's
   * record no longer describes what is on it, and the paste is verbatim. Answering at the moment
   * the answer is needed is why this feature has no clipboard polling and no OS clipboard observer —
   * there is no event to miss.
   */
  ipcMain.handle('throng:clipboard:paste', async () => ({
    text: await clipboard.read(),
    mode: await clipboard.pasteMode(),
  }));
}
