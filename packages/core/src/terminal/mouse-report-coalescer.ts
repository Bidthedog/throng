import { logExpected } from '../diagnostics/caught.js';

/**
 * Mouse-motion coalescing on the way into a PTY (#544).
 *
 * A program with mouse tracking on gets an SGR report (`ESC[<b;x;yM`) for every cell the pointer crosses. When
 * anything on the input path stalls — the daemon or the console host starved of CPU — those reports queue up, and
 * the console host later reads the backlog in large fixed-size pieces. A report that straddles two pieces reaches
 * the program in two reads; a program that stops waiting for the rest of an escape sequence types the tail
 * (`5;71;61M`) into its input. Measured on Windows' system conhost: 2,000 queued reports, one cut at a 23,040-byte
 * read.
 *
 * Only the latest pointer position matters to a program, so motion reports are thinned to one per window: the first
 * goes out at once, any that follow inside the window replace each other, and the latest goes out when the window
 * ends. A stall then queues one report, not thousands. Everything else — presses, releases, the wheel, keys, pastes,
 * replies — goes straight through, after any motion report still waiting, so order is never changed.
 */

/** One frame: the pointer rate Chromium already delivers, so a window this long changes nothing in normal use. */
export const MOUSE_MOTION_WINDOW_MS = 16;

/** A single SGR mouse report with the motion bit (32) set and no wheel bit (64): pointer movement, held button or not. */
// eslint-disable-next-line no-control-regex -- an SGR mouse report starts with ESC; matching one is the point.
const SGR_REPORT = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

export function isMouseMotionReport(data: string): boolean {
  const m = SGR_REPORT.exec(data);
  if (!m) return false;
  const button = Number(m[1]);
  return (button & 32) !== 0 && (button & 64) === 0;
}

export interface CoalescerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MouseReportCoalescer {
  /** Pass one write on to the PTY, thinning it if it is a motion report. */
  write(data: string): void;
  /** Drop any motion report still waiting and stop the timer. The PTY is going away. */
  dispose(): void;
}

/**
 * @param send  the PTY write. May throw (a PTY that is ending refuses writes): a throw from a write made
 *              synchronously propagates to the caller; one at the window's end has no caller, so it is logged.
 */
export function createMouseReportCoalescer(
  send: (data: string) => void,
  windowMs: number = MOUSE_MOTION_WINDOW_MS,
  timers: CoalescerTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never) },
): MouseReportCoalescer {
  let timer: unknown;
  let pending: string | undefined;
  let disposed = false;

  const openWindow = (): void => {
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (pending === undefined || disposed) return;
      const latest = pending;
      pending = undefined;
      openWindow();
      try {
        send(latest);
      } catch (error) {
        logExpected(
          'mouse-report-coalescer: deferred write',
          'a PTY that refuses a write is ending; its exit is reported on its own path',
          error,
        );
      }
    }, windowMs);
  };

  return {
    write(data) {
      if (disposed) return;
      if (isMouseMotionReport(data)) {
        if (timer !== undefined) {
          pending = data;
          return;
        }
        openWindow();
        send(data);
        return;
      }
      if (pending !== undefined) {
        const latest = pending;
        pending = undefined;
        send(latest);
      }
      send(data);
    },
    dispose() {
      disposed = true;
      pending = undefined;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
    },
  };
}
