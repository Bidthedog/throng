/**
 * The Print Preview window (075 FR-064, FR-068, FR-071, research R11, Clarifications Q3 = B).
 *
 * Its own throng window, modal to the window that asked for it: the parent cannot be used until it closes, and
 * closing the parent closes it. There is only ever one (the controller enforces that). It loads the renderer with
 * `?printPreview=<job>`, which mounts the Print Preview app under the active theme; the app draws the pages itself
 * from the PDF the controller lays out (FR-068a).
 */
import { BrowserWindow } from 'electron';
import type { IShellIntegration } from '@throng/core';
import type { PrintPreviewWindowLike } from './print-controller.js';
import type { SecondaryWindowChrome } from './window-chrome.js';
import { appIcon } from './app-icon.js';
import { denyRendererWindows } from './window-open-guard.js';
import { revealWhenPainted } from './reveal-when-painted.js';
import { placeOverParent } from './window-placement.js';
import { wireWindowMaximizeEvents } from './window-controls-ipc.js';

export interface PrintPreviewWindowDeps {
  readonly indexHtml: string;
  readonly query?: Record<string, string>;
  readonly preloadPath: string;
  readonly shellIntegration: IShellIntegration;
  readonly backgroundColor?: () => string;
  readonly chrome?: () => SecondaryWindowChrome;
}

/** Open the window for `jobId`, modal to `parent` when it is a live window. */
export function openPrintPreviewWindow(parent: unknown, jobId: string, deps: PrintPreviewWindowDeps): PrintPreviewWindowLike {
  const owner = parent instanceof BrowserWindow && !parent.isDestroyed() ? parent : undefined;
  const size = { width: 1000, height: 760 };
  const win = new BrowserWindow({
    ...size,
    ...placeOverParent(owner, size),
    minWidth: 640,
    // FR-069 (2026-11-20) — tall enough for every setting at once (custom margins, a custom scale and a page range:
    // about 620 px of controls under the title bar), so the settings pane never scrolls.
    minHeight: 680,
    ...(deps.chrome?.() ?? { frame: false }),
    ...(owner !== undefined ? { parent: owner, modal: true } : {}),
    minimizable: false,
    maximizable: false,
    // FR-071 (2026-11-20) — above other windows, throng's and other applications', while it is open. A platform
    // that ignores the hint leaves it modal to its parent, as before.
    alwaysOnTop: true,
    title: 'Print Preview — throng',
    icon: appIcon(),
    backgroundColor: deps.backgroundColor?.() ?? '#10131a',
    show: false,
    webPreferences: { preload: deps.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  wireWindowMaximizeEvents(win);
  denyRendererWindows(win.webContents, deps.shellIntegration);
  revealWhenPainted(win);

  const listeners: (() => void)[] = [];
  win.on('closed', () => {
    for (const listener of listeners.splice(0)) listener();
    if (owner !== undefined && !owner.isDestroyed()) owner.focus();
  });

  void win.loadFile(deps.indexHtml, { query: { ...deps.query, printPreview: jobId } });

  return {
    focus: () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    },
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
    onClosed: (listener) => {
      listeners.push(listener);
    },
  };
}
