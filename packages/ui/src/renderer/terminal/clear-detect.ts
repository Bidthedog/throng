/**
 * Detect a full-screen clear in a PTY output chunk (005 Phase C). ConPTY does NOT
 * emit a clean `ESC[2J`/`ESC[3J` for `cls`; it moves the cursor home (`ESC[H`) then
 * erases each row (`ESC[K` + newline), which repaints the viewport but scrolls the
 * old contents into xterm's scrollback. We detect that (and the plain `ESC[2J`
 * other shells use, and a full `ESC c` reset) so the caller can drop the stale
 * scrollback.
 *
 * Guards against false positives:
 *  - the alt screen (`ESC[?1049`) — full-screen TUIs (vim, …) manage their own
 *    buffer and must keep the scrollback;
 *  - a real clear erases (nearly) the WHOLE screen, so we require the home+erase
 *    form to erase close to `rows` lines. A PSReadLine partial redraw (which fires
 *    constantly while scrolling/editing in Windows PowerShell) erases only a few
 *    lines and must NOT be treated as a clear.
 *
 * Pure (no DOM/xterm import) so it is unit-testable.
 */
export function isScreenClear(data: string, rows = 24): boolean {
  if (data.includes('\x1b[?1049')) return false; // entering/leaving the alt screen
  if (data.includes('\x1b[2J') || data.includes('\x1bc')) return true;
  if (data.includes('\x1b[H')) {
    const erases = data.match(/\x1b\[K/g)?.length ?? 0;
    if (erases >= Math.max(8, rows - 2)) return true;
  }
  return false;
}

/**
 * How long after a PTY resize to treat cls-shaped output as the resize repaint
 * rather than a real clear. Covers the renderer→daemon→ConPTY→renderer round trip
 * for the repaint that a resize triggers; short enough that a genuine `cls` the
 * user issues later is still honoured.
 */
export const RESIZE_REPAINT_WINDOW_MS = 600;

/**
 * Whether a chunk should drop xterm's scrollback (a real cls/clear). Growing a
 * terminal makes ConPTY repaint the whole enlarged viewport — cursor-home plus one
 * line-erase per row — which is the SAME shape as a `cls`, so {@link isScreenClear}
 * alone would wipe the scrollback on every enlarge. We therefore suppress the drop
 * for a brief window right after a resize: within it the cls-shaped output is the
 * resize repaint (write it, keep the scrollback); outside it, it is a real clear.
 * `msSinceResize` is the time since the last PTY resize (Infinity/large if none).
 */
export function shouldDropScrollback(data: string, rows: number, msSinceResize: number): boolean {
  if (msSinceResize < RESIZE_REPAINT_WINDOW_MS) return false; // resize repaint, not a clear
  return isScreenClear(data, rows);
}
