/**
 * preferences-window — the single shared, frameless, movable preferences
 * BrowserWindow (feature 007, FR-010/013/013a/014). It is **parented to the main
 * window** so it floats above throng's own windows only (not above other OS apps)
 * and minimises/restores with the main window; opening it makes every other window
 * non-interactive (`setEnabled(false)`, app-modal) yet the preferences window
 * itself stays movable to reveal them (FR-014). On close the main window is
 * refocused so no other application is left overlaying throng (FR-013a).
 * Re-invoking the cog focuses the one window and switches its tab (FR-010).
 */
import { BrowserWindow } from 'electron';
import { wireWindowMaximizeEvents } from './window-controls-ipc.js';

export type PreferencesTab = 'settings' | 'keybindings' | 'themes';

const PREF_TABS: readonly PreferencesTab[] = ['settings', 'keybindings', 'themes'];

/** Channel the prefs renderer listens on to switch tab when the window is reused. */
export const PREFERENCES_TAB_CHANNEL = 'throng:preferences:tab';

export function isPreferencesTab(value: unknown): value is PreferencesTab {
  return typeof value === 'string' && (PREF_TABS as readonly string[]).includes(value);
}

export interface PreferencesWindowDeps {
  /** Absolute path to the renderer index.html (loaded with `?prefs=<tab>`). */
  indexHtml: string;
  /** Absolute path to the sandboxed preload script. */
  preloadPath: string;
  backgroundColor?: string;
  /** The current main window — used to parent the prefs window (FR-013) and to
   *  refocus throng when it closes (FR-013a). Resolved lazily at open time. */
  getMainWindow?: () => BrowserWindow | null;
  /** Capture the reset-all on-entry snapshot when the window (first) opens (FR-024). */
  onOpen?: () => void;
  /** Restore interactivity bookkeeping after the window closes. */
  onClose?: () => void;
}

let prefsWindow: BrowserWindow | null = null;

/** Re-enable every still-living window (called when preferences closes). */
function enableAllWindows(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.setEnabled(true);
  }
}

/**
 * Create-or-focus the single preferences window on `tab`. Idempotent: a second
 * call focuses the existing window and switches its tab (FR-010/011).
 */
export function openPreferences(tab: PreferencesTab, deps: PreferencesWindowDeps): BrowserWindow {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.webContents.send(PREFERENCES_TAB_CHANNEL, tab);
    if (prefsWindow.isMinimized()) prefsWindow.restore();
    prefsWindow.focus();
    return prefsWindow;
  }

  // App-modal: disable every existing window before creating the prefs window, so
  // the prefs window is the only interactive surface (FR-013).
  for (const w of BrowserWindow.getAllWindows()) w.setEnabled(false);

  const mainWindow = deps.getMainWindow?.() ?? null;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

  const win = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 420,
    minHeight: 360,
    frame: false,
    // Parented to the main window: floats above throng's own windows only (not
    // globally always-on-top) and minimises/restores with it (FR-013/013a).
    parent,
    movable: true,
    resizable: true,
    title: 'throng — Preferences',
    backgroundColor: deps.backgroundColor ?? '#10131a',
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  prefsWindow = win;
  wireWindowMaximizeEvents(win);
  deps.onOpen?.();

  // Minimise/restore-together with the main window (FR-013a) is native to the
  // `parent` relationship: a parented child hides when its parent is minimised and
  // returns when the parent is restored — no explicit wiring needed.

  win.on('closed', () => {
    prefsWindow = null;
    enableAllWindows();
    // Return focus to throng so no other application is left overlaying it (FR-013a).
    const main = deps.getMainWindow?.() ?? null;
    if (main && !main.isDestroyed()) main.focus();
    deps.onClose?.();
  });

  void win.loadFile(deps.indexHtml, { query: { prefs: tab } });
  return win;
}

/** Whether the preferences window is currently open. */
export function isPreferencesOpen(): boolean {
  return prefsWindow !== null && !prefsWindow.isDestroyed();
}

/** Close the preferences window if open (used on app teardown paths). */
export function closePreferences(): void {
  if (prefsWindow && !prefsWindow.isDestroyed()) prefsWindow.close();
}
