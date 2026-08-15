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
import { app, BrowserWindow } from 'electron';
import { wireWindowMaximizeEvents } from './window-controls-ipc.js';
import { denyRendererWindows } from './window-open-guard.js';
import { appIcon } from './app-icon.js';
import { revealWhenPainted } from './reveal-when-painted.js';
import { placeOverParent } from './window-placement.js';

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

/**
 * The close gate (032, FR-018/FR-018a).
 *
 * Main asks the preferences renderer whether it may close; the renderer answers, and answers `false`
 * only while the JSON editor holds a document that does not parse or fails validation. A refusal is
 * accompanied on screen by a notice naming what is wrong and offering *Discard changes and close*,
 * so the window is never a trap.
 */
export const PREFERENCES_CLOSE_REQUEST_CHANNEL = 'throng:preferences:closeRequest';
export const PREFERENCES_CLOSE_REPLY_CHANNEL = 'throng:preferences:closeReply';

/**
 * How long main waits for that answer before closing anyway.
 *
 * A window that cannot be closed is a strictly worse defect than the one FR-018 fixes, and a
 * renderer can be wedged, mid-reload, or simply not listening — an older build of the page, for
 * instance. So the gate FAILS OPEN. The cost of failing open is a lost buffer the user could have
 * been warned about; the cost of failing closed is an application the user has to kill from Task
 * Manager.
 */
const CLOSE_REPLY_TIMEOUT_MS = 1_500;

/**
 * Tell every window except `except` whether it is now blurred by the app-modal preferences window.
 *
 * Every send is guarded, because this runs from the prefs window's `closed` handler and therefore
 * runs DURING SHUTDOWN, when the other windows are being torn down around it. `isDestroyed()` alone
 * was not enough: a window reports itself alive for a moment after its `webContents` has gone, and
 * either can be destroyed between the check and the send. Sending to a dead one throws
 * `TypeError: Object has been destroyed` out of an event handler with nothing to catch it, which
 * kills the MAIN PROCESS mid-quit (exit code 7) — so the rest of the shutdown, including the
 * settings/layout drain that `terminate-all-drain` exists to protect, never runs.
 *
 * Observed twice per full local E2E run, silently, until the harness started reporting an app that
 * dies while a test is still using it (#240).
 */
function broadcastBlurred(blurred: boolean, except?: BrowserWindow): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === except) continue;
    try {
      if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
      w.webContents.send(WINDOW_BLURRED_CHANNEL, blurred);
    } catch {
      /* destroyed between the check and the send — it needs no blur notice either way */
    }
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
  /** The saved theme's app-background colour, resolved lazily at open time so the
   *  window never flashes a hardcoded dark before its themed content paints (issue 132). */
  backgroundColor?: () => string;
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

  const size = { width: 780, height: 640 };
  const win = new BrowserWindow({
    ...size,
    /*
     * Centred on the MAIN WINDOW, not on the primary monitor.
     *
     * With no `x`/`y` Electron chose its default position, which is the primary display — so with
     * throng on a second monitor the user clicked the cog on one screen and Preferences appeared on
     * another. Being parented does not help: parenting governs stacking and minimise/restore, never
     * placement.
     */
    ...placeOverParent(parent, size),
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
    backgroundColor: deps.backgroundColor?.() ?? '#10131a',
    // Hidden until painted so the preferences window never flashes an empty black frame (issue 132).
    show: false,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  prefsWindow = win;
  wireWindowMaximizeEvents(win);
  denyRendererWindows(win.webContents); // 024 US7 (FR-019b)
  revealWhenPainted(win);
  // Flag every other window blurred (US10/FR-035) — they are app-modal-disabled behind this window,
  // so any stranded CSS :hover on them must stop painting.
  broadcastBlurred(true, win);
  deps.onOpen?.();

  // Minimise/restore-together with the main window (FR-013a) is native to the
  // `parent` relationship: a parented child hides when its parent is minimised and
  // returns when the parent is restored — no explicit wiring needed.

  const unwireLayering = wirePreferencesLayering(win);
  const unwireCloseGate = wireCloseGate(win);

  win.on('closed', () => {
    unwireLayering();
    unwireCloseGate();
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

/**
 * Ask the renderer before closing, so an invalid JSON buffer can refuse (032, FR-018).
 *
 * ══ WHY THE GATE IS HERE AND NOT ON THE CLOSE BUTTON ══
 *
 * The renderer's own title-bar close button is one of several ways this window closes: Alt+F4, the
 * taskbar's close, `closePreferences()` on a teardown path and the OS session end all arrive at
 * `win.close()` without passing through any React handler. Gating the button would leave every
 * other route open, and the user would learn that the block "sometimes" works — worse than no block
 * at all, because it is not predictable.
 *
 * ══ WHY IT FAILS OPEN ══
 *
 * See {@link CLOSE_REPLY_TIMEOUT_MS}. A window that cannot be closed is a worse defect than the one
 * this prevents, so silence is consent. Every path that can leave the gate stuck — a destroyed
 * window, a renderer that never answers, a second close arriving while the first is in flight — is
 * resolved towards closing.
 */
function wireCloseGate(win: BrowserWindow): () => void {
  /*
   * Set once the renderer has agreed (or has failed to answer), so the `close()` we then call is
   * not intercepted again. Without it the second close asks a second time and the window can never
   * shut — the infinite-prompt bug that every "confirm before closing" implementation writes once.
   */
  let allowed = false;
  let asking = false;
  let requestSeq = 0;

  const onCloseReply = (
    _event: Electron.IpcMainEvent,
    payload: { requestId?: number; allow?: boolean },
  ): void => {
    // Ignore an answer to a question we are no longer asking — a stale reply from a previous close
    // attempt must not close the window the user has since carried on editing in.
    if (!asking || payload?.requestId !== requestSeq) return;
    asking = false;
    if (payload.allow !== true) return; // refused: the renderer is showing the user why
    allowed = true;
    if (!win.isDestroyed()) win.close();
  };

  win.webContents.ipc.on(PREFERENCES_CLOSE_REPLY_CHANNEL, onCloseReply);

  win.on('close', (event) => {
    if (allowed) return;
    event.preventDefault();
    if (asking) return; // a question is already outstanding; do not stack them

    if (win.webContents.isDestroyed()) {
      allowed = true;
      win.close();
      return;
    }

    asking = true;
    const requestId = (requestSeq += 1);
    win.webContents.send(PREFERENCES_CLOSE_REQUEST_CHANNEL, { requestId });

    setTimeout(() => {
      // Silence is consent. See CLOSE_REPLY_TIMEOUT_MS.
      if (!asking || requestId !== requestSeq) return;
      asking = false;
      allowed = true;
      if (!win.isDestroyed()) win.close();
    }, CLOSE_REPLY_TIMEOUT_MS);
  });

  return () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.ipc.off(PREFERENCES_CLOSE_REPLY_CHANNEL, onCloseReply);
    }
  };
}

/**
 * Keep Preferences above throng's own windows — and only throng's (#263 follow-up).
 *
 * ══ WHY PARENTING IS NOT ENOUGH ══
 *
 * Preferences is parented to the MAIN window, which is what makes it float above that one even when
 * the user clicks back into it. A sub-workspace is a separate top-level window with no such
 * relationship, so nothing ordered the two — and among siblings there is no defined order to rely on.
 *
 * That gap was invisible while sub-workspaces created during Preferences were disabled: a window
 * that cannot be focused cannot be raised either, so the old `setEnabled(false)` was accidentally
 * doing the layering's job. Removing it (#263) fixed the interactivity and revealed that the
 * layering had never actually been implemented.
 *
 * ══ WHY NOT alwaysOnTop ══
 *
 * `setAlwaysOnTop` is OS-global: there is no portable "above my own app only" level. It would put
 * Preferences over the user's browser and editor too, which is exactly the behaviour 007 already
 * reversed once ("floats only above throng's own windows, not above other applications").
 *
 * So instead the window is re-raised whenever another throng window appears or takes focus.
 * `moveTop` raises WITHOUT focusing, so clicking a sub-workspace still gives that window the
 * keyboard — it simply renders beneath Preferences, which is the stated rule.
 */
export function raisePreferencesAbove(): void {
  if (prefsWindow && !prefsWindow.isDestroyed()) prefsWindow.moveTop();
}

/**
 * Keep Preferences above throng's windows and below everyone else's, by scoping `alwaysOnTop` to
 * throng having focus.
 *
 * ══ WHY moveTop() ON FOCUS WAS NOT ENOUGH ══
 *
 * The first attempt raised Preferences whenever another throng window was shown or focused. It does
 * not hold, and the reason is structural rather than a tuning problem: the OS raises the window the
 * user clicked as part of the same interaction, and it does so AFTER the focus handler has run. The
 * fix was racing the very event it was hooked to, and lost.
 *
 * ══ WHY THIS SHAPE ══
 *
 * `setAlwaysOnTop` is the only thing Electron offers that genuinely wins a z-order fight, and its
 * problem has always been that it is OS-global: it would put Preferences over the user's browser
 * too, which 007 explicitly reversed once already.
 *
 * So the flag is held only while THRONG has focus. Click a sub-workspace and Preferences stays
 * above it; alt-tab to a browser and every throng window drops behind, Preferences included. That is
 * the stated rule — "always on top of throng windows, but not on top of other app windows" —
 * expressed directly rather than approximated.
 *
 * `getFocusedWindow()` is read on the next tick because during an alt-tab or a click between two
 * throng windows there is a moment when nothing is focused yet; acting on that instant would drop
 * the flag and re-raise it on every click, which flickers.
 */
function syncTopmost(): void {
  setImmediate(() => {
    if (!prefsWindow || prefsWindow.isDestroyed()) return;
    const throngHasFocus = BrowserWindow.getFocusedWindow() !== null;
    if (prefsWindow.isAlwaysOnTop() !== throngHasFocus) {
      prefsWindow.setAlwaysOnTop(throngHasFocus);
    }
  });
}

/**
 * Wire the app-level focus tracking that keeps Preferences correctly layered, and hand back the
 * teardown.
 *
 * Deliberately app-level rather than per-window: a window created after Preferences opened would
 * otherwise need wiring of its own, which is exactly the omission that produced #263 in the first
 * place — behaviour attached to individual windows at creation time, and missed for the ones created
 * later.
 */
function wirePreferencesLayering(win: BrowserWindow): () => void {
  const onFocusChange = (): void => syncTopmost();
  app.on('browser-window-focus', onFocusChange);
  app.on('browser-window-blur', onFocusChange);
  syncTopmost();

  return () => {
    app.off('browser-window-focus', onFocusChange);
    app.off('browser-window-blur', onFocusChange);
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  };
}
