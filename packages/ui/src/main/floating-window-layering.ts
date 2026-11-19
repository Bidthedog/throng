/**
 * Keep a floating window — Preferences (007/021) or the Resource Monitor (055 FR-083) — above throng's
 * windows and below everyone else's, by scoping `alwaysOnTop` to throng having focus.
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
 * problem has always been that it is OS-global: it would put the window over the user's browser
 * too, which 007 explicitly reversed once already.
 *
 * So the flag is held only while THRONG has focus. Click a sub-workspace and the floating window stays
 * above it; alt-tab to a browser and every throng window drops behind, the floating one included. That
 * is the stated rule — "always on top of throng windows, but not on top of other app windows" —
 * expressed directly rather than approximated.
 *
 * Focus is read on the next tick because during an alt-tab or a click between two throng windows
 * there is a moment when nothing is focused yet; acting on that instant would drop the flag and
 * re-raise it on every click, which flickers.
 *
 * ══ WHY APP-LEVEL ══
 *
 * The focus tracking is app-level rather than per-window: a window created after the floating one
 * opened would otherwise need wiring of its own, which is exactly the omission that produced #263 —
 * behaviour attached to individual windows at creation time, and missed for the ones created later.
 */
import { app, BrowserWindow } from 'electron';

/** The three things the rule needs from Electron — a seam, so the rule is testable without a window. */
export interface LayeringSeam {
  /** Call `listener` whenever any throng window gains or loses focus; returns the unsubscribe. */
  onFocusChange(listener: () => void): () => void;
  throngHasFocus(): boolean;
  /** Run `fn` on the next tick. */
  defer(fn: () => void): void;
}

/** The part of a `BrowserWindow` the rule touches. */
export interface FloatingWindow {
  isDestroyed(): boolean;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(flag: boolean): void;
}

export function electronLayeringSeam(): LayeringSeam {
  return {
    onFocusChange: (listener) => {
      app.on('browser-window-focus', listener);
      app.on('browser-window-blur', listener);
      return () => {
        app.off('browser-window-focus', listener);
        app.off('browser-window-blur', listener);
      };
    },
    throngHasFocus: () => BrowserWindow.getFocusedWindow() !== null,
    defer: (fn) => setImmediate(fn),
  };
}

/** The yield of every wired floating window, so another app's window can be shown above them all. */
const yields = new Set<() => void>();

/**
 * Let a window throng is about to open in ANOTHER application — a folder in the file manager (069) —
 * come up above the floating windows. Each drops its flag and keeps it down until throng has lost
 * focus once: holding it while throng still has focus put Preferences over the very folder the user
 * had just asked it to open. When the user comes back to throng, the rule above applies again.
 */
export function yieldFloatingWindows(): void {
  for (const y of yields) y();
}

/** Wire the layering for `win`, and hand back the teardown (which drops the flag). */
export function wireFloatingLayering(win: FloatingWindow, seam: LayeringSeam = electronLayeringSeam()): () => void {
  let yielded = false;
  // What this rule last asked for. `isAlwaysOnTop()` alone cannot answer "is it already set?": on X11
  // it is Chromium's cache of `_NET_WM_STATE_ABOVE`, re-read on EVERY `_NET_WM_STATE` change — one
  // for an unrelated atom (the window manager clearing `_NET_WM_STATE_FOCUSED` on blur) can report
  // `true` after a `setAlwaysOnTop(false)` the window manager has not applied yet. Trusting it skipped
  // the re-raise, and the drop then landed with nothing left to undo it: the monitor stayed below throng.
  let requested: boolean | null = null;
  const apply = (want: boolean): void => {
    if (requested === want && win.isAlwaysOnTop() === want) return;
    requested = want;
    win.setAlwaysOnTop(want);
  };
  const sync = (): void =>
    seam.defer(() => {
      if (win.isDestroyed()) return;
      const throngHasFocus = seam.throngHasFocus();
      if (!throngHasFocus) yielded = false;
      apply(throngHasFocus && !yielded);
    });
  const yieldNow = (): void => {
    yielded = true;
    if (!win.isDestroyed()) apply(false);
  };
  yields.add(yieldNow);
  const off = seam.onFocusChange(sync);
  sync();
  return () => {
    off();
    yields.delete(yieldNow);
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  };
}
