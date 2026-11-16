/**
 * window-controls-ipc — the custom title bar's min/max/close plumbing (feature
 * 007, FR-002/004). The frameless windows draw their own controls in the
 * renderer; those controls relay here, and each handler targets the **sender's**
 * BrowserWindow so the main window and every sub-workspace window control
 * themselves independently (Principle XI independent-minimise).
 *
 * Maximise goes through `WindowMaximise`, which maximises a parented window on Linux by hand because
 * the window manager will not (window-maximise.ts).
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import { WindowMaximise, type MaximiseTarget } from './window-maximise.js';

export const WINDOW_CONTROL_CHANNELS = {
  minimize: 'throng:window:minimize',
  maximize: 'throng:window:maximize',
  close: 'throng:window:close',
  isMaximized: 'throng:window:isMaximized',
  maximizeChanged: 'throng:window:maximizeChanged',
} as const;

const maximise = new WindowMaximise(process.platform);

function target(win: BrowserWindow): MaximiseTarget {
  return {
    id: win.id,
    isMaximized: () => win.isMaximized(),
    maximize: () => win.maximize(),
    unmaximize: () => win.unmaximize(),
    getBounds: () => win.getBounds(),
    setBounds: (bounds) => win.setBounds(bounds),
    workArea: () => screen.getDisplayMatching(win.getBounds()).workArea,
    hasParent: () => win.getParentWindow() !== null,
    notify: (maximized) => {
      if (!win.isDestroyed()) win.webContents.send(WINDOW_CONTROL_CHANNELS.maximizeChanged, maximized);
    },
  };
}

/** Wire the window-control handlers onto `ipcMain` (idempotent per app run). */
export function registerWindowControlsIpc(): void {
  ipcMain.on(WINDOW_CONTROL_CHANNELS.minimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on(WINDOW_CONTROL_CHANNELS.maximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) maximise.toggle(target(win));
  });
  ipcMain.on(WINDOW_CONTROL_CHANNELS.close, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle(WINDOW_CONTROL_CHANNELS.isMaximized, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? maximise.isMaximized(target(win)) : false;
  });
}

/**
 * Push `maximizeChanged` to a window's renderer whenever it maximises/restores,
 * so the custom title bar can swap the maximise↔restore glyph. Attach once per
 * created window.
 */
export function wireWindowMaximizeEvents(win: BrowserWindow): void {
  const id = win.id;
  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(WINDOW_CONTROL_CHANNELS.maximizeChanged, win.isMaximized());
    }
  };
  win.on('maximize', send);
  win.on('unmaximize', send);
  win.on('closed', () => maximise.forget(id));
}
