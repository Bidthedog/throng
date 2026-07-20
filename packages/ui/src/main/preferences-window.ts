/**
 * preferences-window — the single shared, frameless, movable preferences
 * BrowserWindow (feature 007, FR-010/013/013a/014; made NON-MODAL in 021). It is
 * **parented to the main window**, so it floats above throng's own windows only (not
 * above other OS apps) and minimises/restores with the main window — and, being a
 * parented child, it STAYS ABOVE the main window even when the user clicks back into it.
 * It is deliberately NOT app-modal: every other window stays INTERACTIVE while it is
 * open, so a theme can be edited and its effect watched on the live application at the
 * same time (which is the whole point of floating over throng rather than blocking it).
 * On close, focus returns to the main window so no other application is left overlaying
 * throng (FR-013a). Re-invoking the cog focuses the one window and switches its tab
 * (FR-010).
 */
import { BrowserWindow } from 'electron';
import { wireWindowMaximizeEvents } from './window-controls-ipc.js';
import { appIcon } from './app-icon.js';

export type PreferencesTab = 'settings' | 'keybindings' | 'themes';

const PREF_TABS: readonly PreferencesTab[] = ['settings', 'keybindings', 'themes'];

/** Channel the prefs renderer listens on to switch tab when the window is reused. */
export const PREFERENCES_TAB_CHANNEL = 'throng:preferences:tab';

/**
 * Channel every OTHER window listens on to learn it has been blurred by the app-modal preferences
 * window (US10/FR-035). The OS `blur` event is not delivered reliably to a disabled window under the
 * test harness, so this is the deterministic "a child window took focus" signal the hover-suppression
 * gate needs. `true` when preferences opens, `false` when it closes.
 */
export const WINDOW_BLURRED_CHANNEL = 'throng:window:blurred';

/** Tell every window except `except` whether it is now blurred by the app-modal preferences window. */
function broadcastBlurred(blurred: boolean, except?: BrowserWindow): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === except || w.isDestroyed()) continue;
    w.webContents.send(WINDOW_BLURRED_CHANNEL, blurred);
  }
}

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

  const mainWindow = deps.getMainWindow?.() ?? null;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

  const win = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 420,
    minHeight: 360,
    frame: false,
    // Parented to the main window: it floats above throng's own windows only (not globally
    // always-on-top, so never above other OS apps), stays above the main window even when the user
    // clicks into it, and minimises/restores with it (FR-013/013a). Deliberately NOT modal — every
    // other window stays interactive (021), so throng can be used while a theme is being edited.
    parent,
    movable: true,
    resizable: true,
    // US9/FR-034 — Preferences cannot minimise (no minimise affordance in the renderer either).
    minimizable: false,
    title: 'Preferences — throng',
    icon: appIcon(),
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
  // Flag every other window blurred (US10/FR-035) — they are app-modal-disabled behind this window,
  // so any stranded CSS :hover on them must stop painting.
  broadcastBlurred(true, win);
  deps.onOpen?.();

  // Minimise/restore-together with the main window (FR-013a) is native to the
  // `parent` relationship: a parented child hides when its parent is minimised and
  // returns when the parent is restored — no explicit wiring needed.

  win.on('closed', () => {
    prefsWindow = null;
    // Clear the blurred flag on every window (US10/FR-035). The hover gate does not repaint until a
    // genuine pointermove, so a stranded element stays un-hovered until the user actually moves.
    broadcastBlurred(false);
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
