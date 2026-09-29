/**
 * The Go to Heading pop-down's scroll animation (047 US4, research.md R7).
 *
 * Native `scrollTo({ behavior: 'smooth' })` has no way to say HOW LONG it takes — and
 * `providers.markdown.headingJumpMs` is a duration the reader sets (FR-042d), `0` meaning instant. A
 * small `requestAnimationFrame` tween is the only way to honour that: it drives `scrollTop` directly, a
 * frame at a time, so scroll sync sees an ordinary preview scroll (044 FR-121f) rather than anything
 * special about how it got there.
 *
 * The scheduler is injected (`ScrollTweenScheduler`) so this is testable with a manual clock rather
 * than a real animation frame loop — the `scroll-anchor.ts` precedent of faking the surface, not the
 * runtime.
 */

/** The minimal target a tween needs — a real `HTMLElement` satisfies this unchanged. */
export interface ScrollTweenTarget {
  scrollTop: number;
}

export interface ScrollTweenScheduler {
  now(): number;
  raf(cb: (t: number) => void): number;
  cancelRaf(id: number): void;
}

const realScheduler: ScrollTweenScheduler = {
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  cancelRaf: (id) => cancelAnimationFrame(id),
};

/** One in-flight tween per target, so a second jump before the first finishes replaces it cleanly. */
const active = new WeakMap<ScrollTweenTarget, () => void>();

/**
 * Animate `target.scrollTop` from its current value to `to` over `durationMs`. `durationMs <= 0` (or
 * already there) sets it once, synchronously, and schedules nothing. Returns a cancel function; calling
 * `tweenScrollTop` again on the SAME target cancels whatever was already running there automatically —
 * a caller never has to remember to.
 */
export function tweenScrollTop(
  target: ScrollTweenTarget,
  to: number,
  durationMs: number,
  scheduler: ScrollTweenScheduler = realScheduler,
): () => void {
  active.get(target)?.();

  const from = target.scrollTop;
  if (durationMs <= 0 || from === to) {
    target.scrollTop = to;
    const noop = (): void => {};
    active.delete(target);
    return noop;
  }

  const start = scheduler.now();
  let rafId = 0;
  const cancel = (): void => {
    scheduler.cancelRaf(rafId);
    if (active.get(target) === cancel) active.delete(target);
  };

  const step = (): void => {
    const elapsed = scheduler.now() - start;
    const t = Math.min(1, elapsed / durationMs);
    target.scrollTop = from + (to - from) * t;
    if (t < 1) rafId = scheduler.raf(step);
    else if (active.get(target) === cancel) active.delete(target);
  };

  active.set(target, cancel);
  rafId = scheduler.raf(step);
  return cancel;
}
