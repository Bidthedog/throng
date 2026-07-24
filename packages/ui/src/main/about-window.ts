/**
 * about-window — the single shared, frameless, app-modal "About throng" window
 * (020, FR-003 / FR-003a). It mirrors the preferences-window pattern: one shared
 * BrowserWindow parented to the main window (so it floats above throng's own
 * windows only and minimises/restores with it), app-modal (every other window is
 * disabled while it is open), and it loads the renderer `index.html?about=1` — the
 * renderer reads that query and mounts the About surface. Re-invoking Help → About
 * throng focuses the one window rather than opening a second.
 */
import { BrowserWindow } from 'electron';
import { wireWindowMaximizeEvents } from './window-controls-ipc.js';
import { denyRendererWindows } from './window-open-guard.js';
import { appIcon } from './app-icon.js';
import { revealWhenPainted } from './reveal-when-painted.js';

export interface AboutWindowDeps {
  /** Absolute path to the renderer index.html (loaded with `?about=1`). */
  indexHtml: string;
  /** Absolute path to the sandboxed preload script. */
  preloadPath: string;
  /** The saved theme's app-background colour, resolved lazily at open time so the
   *  window never flashes a hardcoded dark before its themed content paints (issue 132). */
  backgroundColor?: () => string;
  /** The current main window — used to parent the About window and refocus throng
   *  when it closes. Resolved lazily at open time. */
  getMainWindow?: () => BrowserWindow | null;
}

let aboutWindow: BrowserWindow | null = null;

/** Re-enable every still-living window (called when the About window closes). */
function enableAllWindows(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.setEnabled(true);
  }
}

/**
 * Create-or-focus the single About window. Idempotent: a second call focuses the
 * existing window (FR-003 — one entry point, one dialog).
 */
export function openAbout(deps: AboutWindowDeps): BrowserWindow {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    if (aboutWindow.isMinimized()) aboutWindow.restore();
    aboutWindow.focus();
    return aboutWindow;
  }

  // App-modal: disable every existing window before creating the About window, so
  // it is the only interactive surface while it is open (mirrors preferences).
  for (const w of BrowserWindow.getAllWindows()) w.setEnabled(false);

  const mainWindow = deps.getMainWindow?.() ?? null;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

  const win = new BrowserWindow({
    // Wide enough that the full AGPL text (authored at ≤79 columns) shows without a horizontal
    // scrollbar (FR-003a); fixed size — an About dialog has nothing to resize for.
    width: 720,
    height: 680,
    frame: false,
    parent,
    movable: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: 'About — throng',
    icon: appIcon(),
    backgroundColor: deps.backgroundColor?.() ?? '#10131a',
    // Hidden until painted so the About window never flashes an empty black frame on open (issue 132).
    show: false,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aboutWindow = win;
  wireWindowMaximizeEvents(win);
  denyRendererWindows(win.webContents); // 024 US7 (FR-019b)
  revealWhenPainted(win);

  win.on('closed', () => {
    aboutWindow = null;
    enableAllWindows();
    // Return focus to throng so no other application is left overlaying it.
    const main = deps.getMainWindow?.() ?? null;
    if (main && !main.isDestroyed()) main.focus();
  });

  void win.loadFile(deps.indexHtml, { query: { about: '1' } });
  return win;
}

/** Whether the About window is currently open. */
export function isAboutOpen(): boolean {
  return aboutWindow !== null && !aboutWindow.isDestroyed();
}

/** Close the About window if open (used on app teardown paths). */
export function closeAbout(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.close();
}
