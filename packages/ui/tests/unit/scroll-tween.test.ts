/**
 * 047 T054 — the Go to Heading pop-down's scroll tween (research R7): duration from
 * `providers.markdown.headingJumpMs`, `0` sets `scrollTop` once (native `behavior: 'smooth'` has no
 * duration to control, so an instant jump bypasses it entirely), and a new jump on the SAME target
 * cancels whatever tween was already running there — a second jump before the first finishes must not
 * fight it for the final position.
 *
 * A manual scheduler stands in for `requestAnimationFrame`/`performance.now`, since the unit project
 * runs in Node with neither (`scroll-anchor.test.ts`'s precedent: fake the measurement surface, not the
 * DOM).
 */
import { describe, expect, it } from 'vitest';
import { tweenScrollTop, type ScrollTweenScheduler } from '../../src/renderer/preview/scroll-tween.js';

/** A scheduler whose frames run only when `tick()` is called, at a controlled clock. */
function manualScheduler(): ScrollTweenScheduler & { tick: (ms: number) => void; frameCount: number } {
  let clock = 0;
  let pending: ((t: number) => void) | null = null;
  let nextId = 1;
  return {
    frameCount: 0,
    now: () => clock,
    raf(cb) {
      pending = cb;
      this.frameCount += 1;
      return nextId++;
    },
    cancelRaf: () => {
      pending = null;
    },
    tick(ms: number) {
      clock += ms;
      const cb = pending;
      pending = null;
      cb?.(clock);
    },
  };
}

describe('tweenScrollTop', () => {
  it('duration 0 sets scrollTop once, synchronously, and schedules no frame', () => {
    const scheduler = manualScheduler();
    const el = { scrollTop: 50 };
    tweenScrollTop(el, 400, 0, scheduler);
    expect(el.scrollTop).toBe(400);
    expect(scheduler.frameCount).toBe(0);
  });

  it('animates scrollTop over the given duration, ending exactly at the target', () => {
    const scheduler = manualScheduler();
    const el = { scrollTop: 0 };
    tweenScrollTop(el, 200, 200, scheduler);
    scheduler.tick(100); // halfway
    expect(el.scrollTop).toBeCloseTo(100, 0);
    scheduler.tick(100); // done
    expect(el.scrollTop).toBe(200);
  });

  it('a jump already at the target does nothing (no-op, no frame)', () => {
    const scheduler = manualScheduler();
    const el = { scrollTop: 300 };
    tweenScrollTop(el, 300, 200, scheduler);
    expect(scheduler.frameCount).toBe(0);
  });

  it('a NEW jump on the same target cancels the one already running there', () => {
    const scheduler = manualScheduler();
    const el = { scrollTop: 0 };
    tweenScrollTop(el, 1000, 1000, scheduler);
    scheduler.tick(100); // 10% through the first tween
    const midway = el.scrollTop;
    expect(midway).toBeGreaterThan(0);

    // A second jump starts from wherever the first left off, not from 0.
    tweenScrollTop(el, 500, 500, scheduler);
    scheduler.tick(500); // the SECOND tween's full duration
    expect(el.scrollTop).toBe(500);

    // The cancelled first tween's frame must never fire again and overwrite this.
    scheduler.tick(10000);
    expect(el.scrollTop).toBe(500);
  });

  it('the returned cancel function stops the tween mid-flight, leaving scrollTop where it was', () => {
    const scheduler = manualScheduler();
    const el = { scrollTop: 0 };
    const cancel = tweenScrollTop(el, 1000, 1000, scheduler);
    scheduler.tick(300);
    const stoppedAt = el.scrollTop;
    cancel();
    scheduler.tick(700);
    expect(el.scrollTop).toBe(stoppedAt);
  });
});
