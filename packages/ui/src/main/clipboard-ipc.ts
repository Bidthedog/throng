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

export function registerClipboardIpc(clipboard: ClipboardService): void {
  ipcMain.handle('throng:clipboard:write', (_event, raw: Record<string, unknown>) => {
    if (typeof raw?.text !== 'string') return;
    clipboard.write(raw.text, asMode(raw.mode));
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
  ipcMain.handle('throng:clipboard:paste', () => ({
    text: clipboard.read(),
    mode: clipboard.pasteMode(),
  }));
}
