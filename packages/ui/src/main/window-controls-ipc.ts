/**
 * window-controls-ipc — the custom title bar's min/max/close plumbing (feature
 * 007, FR-002/004). The frameless windows draw their own controls in the
 * renderer; those controls relay here, and each handler targets the **sender's**
 * BrowserWindow so the main window and every sub-workspace window control
 * themselves independently (Principle XI independent-minimise).
 */
import { BrowserWindow, ipcMain } from 'electron';

export const WINDOW_CONTROL_CHANNELS = {
  minimize: 'throng:window:minimize',
  maximize: 'throng:window:maximize',
  close: 'throng:window:close',
  isMaximized: 'throng:window:isMaximized',
  maximizeChanged: 'throng:window:maximizeChanged',
} as const;

/** Wire the window-control handlers onto `ipcMain` (idempotent per app run). */
export function registerWindowControlsIpc(): void {
  ipcMain.on(WINDOW_CONTROL_CHANNELS.minimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on(WINDOW_CONTROL_CHANNELS.maximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(WINDOW_CONTROL_CHANNELS.close, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle(WINDOW_CONTROL_CHANNELS.isMaximized, (e) =>
    BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false,
  );
}

/**
 * Push `maximizeChanged` to a window's renderer whenever it maximises/restores,
 * so the custom title bar can swap the maximise↔restore glyph. Attach once per
 * created window.
 */
export function wireWindowMaximizeEvents(win: BrowserWindow): void {
  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(WINDOW_CONTROL_CHANNELS.maximizeChanged, win.isMaximized());
    }
  };
  win.on('maximize', send);
  win.on('unmaximize', send);
}
