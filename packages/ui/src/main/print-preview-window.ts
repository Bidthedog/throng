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
import { PrintPreviewPlacement, PRINT_PREVIEW_MIN_SIZE } from './print-preview-placement.js';

export interface PrintPreviewWindowDeps {
  readonly indexHtml: string;
  readonly query?: Record<string, string>;
  readonly preloadPath: string;
  readonly shellIntegration: IShellIntegration;
  readonly backgroundColor?: () => string;
  readonly chrome?: () => SecondaryWindowChrome;
  /**
   * 075 FR-071 on Linux (maintainer, 2026-11-22) — keep the parent ENABLED and make it modal by hand: its renderer
   * covers itself (`ModalBlocker`) and focus is handed straight back. A natively modal child disables its parent,
   * and a disabled window on Wayland never sets its cursor as the pointer enters it, so the resize cursor from the
   * preview's edge stayed on screen. Other platforms keep native modality.
   *
   * The emulated window has no parent either (maintainer, 2026-11-22: a double-click on its title bar should
   * maximise it). That double-click is the window manager's, and Mutter does not maximise a transient window
   * (`window-maximise.ts`); nothing else needs the parent, since the blocker, the focus hand-back and
   * `alwaysOnTop` hold the modality and the stacking. Closing the window it serves still closes it.
   */
  readonly emulateModal?: boolean;
  /** The last Print Preview's size and maximised state (maintainer, 2026-11-22); the module's own when not given. */
  readonly placement?: PrintPreviewPlacement;
  /** Told once the closing window's placement has been remembered, to keep it for the next session. */
  readonly onPlacement?: () => void;
}

/** Used when the caller keeps no placement of its own (tests). */
const sessionPlacement = new PrintPreviewPlacement();

/** Open the window for `jobId`, modal to `parent` when it is a live window. */
export function openPrintPreviewWindow(parent: unknown, jobId: string, deps: PrintPreviewWindowDeps): PrintPreviewWindowLike {
  const owner = parent instanceof BrowserWindow && !parent.isDestroyed() ? parent : undefined;
  const placement = deps.placement ?? sessionPlacement;
  const { size, maximised } = placement.next();
  const win = new BrowserWindow({
    ...size,
    ...placeOverParent(owner, size),
    // FR-069 (2026-11-20) — tall enough for every setting at once (custom margins, a custom scale and a page range:
    // about 620 px of controls under the title bar), so the settings pane never scrolls.
    minWidth: PRINT_PREVIEW_MIN_SIZE.width,
    minHeight: PRINT_PREVIEW_MIN_SIZE.height,
    ...(deps.chrome?.() ?? { frame: false }),
    ...(owner !== undefined && deps.emulateModal !== true ? { parent: owner, modal: true } : {}),
    minimizable: false,
    // Maximise and Restore (maintainer, 2026-11-22): the title bar's control, or a double-click on it.
    maximizable: true,
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
  // Opened maximised when the last one closed maximised; Restore then returns to the size it had before.
  if (maximised) win.once('show', () => win.isDestroyed() || win.maximize());
  win.on('close', () => {
    placement.remember(win);
    deps.onPlacement?.();
  });

  // The hand-made modality: the parent is covered, and whatever focuses it gives focus back to Print Preview.
  const emulated = owner !== undefined && deps.emulateModal === true ? owner : undefined;
  const handBack = (): void => {
    if (!win.isDestroyed()) win.focus();
  };
  // Unparented, it does not close with that window by itself.
  const closeWithOwner = (): void => {
    if (!win.isDestroyed()) win.close();
  };
  if (emulated !== undefined) {
    emulated.webContents.send('throng:window:modalBlock', true);
    emulated.on('focus', handBack);
    emulated.once('closed', closeWithOwner);
  }

  const listeners: (() => void)[] = [];
  win.on('closed', () => {
    if (emulated !== undefined && !emulated.isDestroyed()) {
      emulated.removeListener('focus', handBack);
      emulated.removeListener('closed', closeWithOwner);
      emulated.webContents.send('throng:window:modalBlock', false);
    }
    for (const listener of listeners.splice(0)) listener();
    if (owner !== undefined && !owner.isDestroyed()) owner.focus();
  });

  void win.loadFile(deps.indexHtml, { query: { ...deps.query, printPreview: jobId } });

  return {
    // FR-082 — the OS's Save dialog is parented to this window, so it opens over it.
    nativeWindow: win,
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
