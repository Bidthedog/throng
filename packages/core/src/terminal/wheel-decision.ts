/**
 * Where a mouse wheel notch goes (028 / #187).
 *
 * The reported bug is that the wheel does nothing at all over a Claude Code session. The mechanism
 * is not a lost event: xterm scrolls the viewport on the NORMAL buffer, and the ALTERNATE screen has
 * no scrollback to scroll. xterm will forward notches as arrow keys there, but only once the program
 * enables DEC private mode 1007 (alternate scroll) — and Claude Code does not. So the wheel arrives,
 * xterm has nothing to scroll and no mandate to translate, and the gesture is silently dropped.
 *
 * throng decides for itself instead. The decision is pure so all four cases can be pinned without a
 * DOM, and so the one dangerous case — never synthesising keys on the normal buffer, where they
 * would land on a shell's command line — is provable rather than hoped for.
 */

/** DEC private modes by which a program claims the mouse: X10/normal, button, any-motion, SGR. */
export const MOUSE_REPORTING_MODES: readonly number[] = [1000, 1002, 1003, 1006];

export interface WheelContext {
  /** The alternate screen is active (a full-screen program is painting). */
  altBuffer: boolean;
  /** The program has claimed mouse reporting, so the wheel belongs to it. */
  mouseReporting: boolean;
  /** The zoom modifier is held. */
  ctrlKey: boolean;
}

/**
 * - `zoom`     — the panel zoom gesture, unchanged (FR-033).
 * - `program`  — the running program claimed the mouse; the event is its (FR-032).
 * - `arrows`   — alternate screen, no mouse reporting: send arrow keys so the wheel drives the
 *                program's own list/pager (FR-035).
 * - `viewport` — normal buffer: xterm scrolls the scrollback (FR-030).
 */
export type WheelRoute = 'zoom' | 'program' | 'arrows' | 'viewport';

export function decideWheel(ctx: WheelContext): WheelRoute {
  if (ctx.ctrlKey) return 'zoom';
  if (ctx.mouseReporting) return 'program';
  return ctx.altBuffer ? 'arrows' : 'viewport';
}

/** Tracks which mouse-reporting modes a program currently has enabled. */
export interface MouseReportingState {
  /**
   * Fold one DEC private mode set/reset in, and answer whether the program is claiming the mouse.
   *
   * Deliberately NOT a boolean flip. A sequence can carry several modes at once
   * (`CSI ? 1002 ; 1006 h`), and programs routinely enable two and disable them one at a time — so
   * a flag would report "mouse released" while 1000 was still live, and hand the program's wheel to
   * the viewport underneath it. The live set is what is tracked; reporting is on while any remains.
   */
  apply(params: readonly number[], enable: boolean): boolean;
  /** Whether any reporting mode is currently set. */
  isOn(): boolean;
}

export function createMouseReportingState(): MouseReportingState {
  const live = new Set<number>();
  return {
    apply(params, enable) {
      for (const mode of params) {
        if (!MOUSE_REPORTING_MODES.includes(mode)) continue;
        if (enable) live.add(mode);
        else live.delete(mode);
      }
      return live.size > 0;
    },
    isOn: () => live.size > 0,
  };
}
