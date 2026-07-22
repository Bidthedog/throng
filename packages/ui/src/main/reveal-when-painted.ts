import type { BrowserWindow } from 'electron';

/**
 * Reveal a window only once it has PAINTED its first frame (issue 132) — the anti-flash pattern.
 *
 * Every throng window is created `show: false`, because a frameless window shown before its first
 * paint flashes an empty black frame on Windows regardless of theme — the whole-window flash users saw
 * on every window and modal open. `ready-to-show` fires after the renderer's first frame, which the
 * preload has already themed, so revealing then is seamless: the window's first visible frame is the
 * finished, correctly-themed UI.
 *
 * The fallback timer guarantees a window is never left hidden if `ready-to-show` is somehow missed (a
 * renderer that never reaches first paint): a late reveal is a poor experience, but an invisible window
 * is a lost one. `isVisible()` keeps the reveal idempotent, and `isDestroyed()` makes the timer safe on
 * a window that was closed before it painted.
 */
export function revealWhenPainted(window: BrowserWindow): void {
  const reveal = (): void => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };
  window.once('ready-to-show', reveal);
  setTimeout(reveal, 4000);
}
