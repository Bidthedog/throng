/**
 * The Print Preview window (075 FR-064, FR-068, FR-071, research R11, Clarifications Q3 = B).
 *
 * Its own throng window, modal to the window that asked for it: the parent cannot be used until it closes, and
 * closing the parent closes it. There is only ever one (the controller enforces that). It loads the renderer with
 * `?printPreview=<job>`, which mounts the Print Preview app under the active theme; the pages are a PDF shown in a
 * view laid over the page area the app reports, by Chromium's own PDF viewer (plan, Complexity Tracking).
 */
import { BrowserWindow, WebContentsView } from 'electron';
import { pathToFileURL } from 'node:url';
import type { IShellIntegration } from '@throng/core';
import type { PageArea, PrintPreviewWindowLike } from './print-controller.js';
import type { SecondaryWindowChrome } from './window-chrome.js';
import { appIcon } from './app-icon.js';
import { closeOnEscape } from './print-pages-session.js';
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
  /**
   * The session the pages view loads its PDFs in (`print-pages-session.ts`). The default session's request
   * filter refuses a `file:` URL outside the renderer's directory, so a view left in it never shows a page.
   */
  readonly pagesSession?: () => Electron.Session;
}

/** Open the window for `jobId`, modal to `parent` when it is a live window. */
export function openPrintPreviewWindow(parent: unknown, jobId: string, deps: PrintPreviewWindowDeps): PrintPreviewWindowLike {
  const owner = parent instanceof BrowserWindow && !parent.isDestroyed() ? parent : undefined;
  const size = { width: 1000, height: 760 };
  const win = new BrowserWindow({
    ...size,
    ...placeOverParent(owner, size),
    minWidth: 640,
    minHeight: 480,
    ...(deps.chrome?.() ?? { frame: false }),
    ...(owner !== undefined ? { parent: owner, modal: true } : {}),
    minimizable: false,
    title: 'Print Preview — throng',
    icon: appIcon(),
    backgroundColor: deps.backgroundColor?.() ?? '#10131a',
    show: false,
    webPreferences: { preload: deps.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  wireWindowMaximizeEvents(win);
  denyRendererWindows(win.webContents, deps.shellIntegration);
  revealWhenPainted(win);

  // The pages: Chromium's PDF viewer in a view of its own, with no script of throng's and no navigation away.
  const pagesSession = deps.pagesSession?.();
  const pages = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, ...(pagesSession !== undefined ? { session: pagesSession } : {}) },
  });
  pages.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  win.contentView.addChildView(pages);
  pages.webContents.on('will-navigate', (event) => event.preventDefault());
  // FR-071 — Escape cancels even when the reader has clicked into the pages, whose keys the app never hears.
  closeOnEscape(pages.webContents, () => {
    if (!win.isDestroyed()) win.close();
  });
  denyRendererWindows(pages.webContents, deps.shellIntegration);

  const listeners: (() => void)[] = [];
  win.on('closed', () => {
    if (!pages.webContents.isDestroyed()) pages.webContents.close();
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
    showPages: async (path) => {
      if (pages.webContents.isDestroyed()) return;
      await pages.webContents.loadURL(`${pathToFileURL(path).href}#toolbar=0&navpanes=0&view=FitH`);
    },
    setPageArea: (area: PageArea) => {
      if (win.isDestroyed()) return;
      pages.setBounds({ x: Math.round(area.x), y: Math.round(area.y), width: Math.max(0, Math.round(area.width)), height: Math.max(0, Math.round(area.height)) });
    },
    onClosed: (listener) => {
      listeners.push(listener);
    },
  };
}
