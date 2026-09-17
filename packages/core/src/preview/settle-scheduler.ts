/**
 * When a parented preview shows a change: a trailing debounce with a maximum wait (044, FR-022,
 * FR-028, FR-060, FR-060a, research R13).
 *
 * A debounce alone starves the preview while the user keeps typing — there is never a quiet gap long
 * enough. A maximum wait alone re-renders on a fixed beat whether or not typing has paused. The
 * scheduler is both: it settles `delayMs` after the LAST change, and in any case no later than
 * `maxWaitMs` after the FIRST change it has not yet shown.
 *
 * One scheduler per preview, in main (R13), so a typing burst sends one snapshot per settle however
 * many windows show the preview, and Refresh (`flush`) bypasses the delay for all of them at once.
 *
 * The clock is injected — the timers are the whole behaviour, and a test that has to sleep to observe
 * them is a test that flakes. Pure otherwise: no OS, no DOM.
 */

/** The timer surface the scheduler needs; `globalThis`'s timers satisfy it in main. */
export interface SettleClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SettleSchedulerOptions {
  delayMs: number;
  /**
   * A value below `delayMs` behaves as equal to it (FR-060a). Applied here as well as by the
   * settings reader, because a scheduler whose forced settle came before its trailing one would
   * silently turn the delay setting into the maximum-wait setting.
   */
  maxWaitMs: number;
  clock: SettleClock;
  /** Show the latest content. Called from a timer, or synchronously by `flush`. */
  onSettle: () => void;
}

export interface SettleScheduler {
  /** A change the preview has not shown yet. */
  change(): void;
  /** Settle now, whether or not anything is pending — Refresh (FR-028). */
  flush(): void;
  /** Drop anything pending without settling — the preview is going away. */
  cancel(): void;
  /** Whether a change is waiting to be shown. */
  readonly pending: boolean;
}

export function createSettleScheduler(options: SettleSchedulerOptions): SettleScheduler {
  const { clock, onSettle } = options;
  const delayMs = Math.max(0, options.delayMs);
  const maxWaitMs = Math.max(delayMs, options.maxWaitMs);

  let firstUnshownAt: number | null = null;
  let timer: unknown = null;

  function clear(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function settle(): void {
    clear();
    firstUnshownAt = null;
    onSettle();
  }

  return {
    change() {
      const now = clock.now();
      if (firstUnshownAt === null) firstUnshownAt = now;
      const deadline = Math.min(now + delayMs, firstUnshownAt + maxWaitMs);
      clear();
      timer = clock.setTimeout(settle, Math.max(0, deadline - now));
    },
    flush: settle,
    cancel() {
      clear();
      firstUnshownAt = null;
    },
    get pending() {
      return firstUnshownAt !== null;
    },
  };
}
