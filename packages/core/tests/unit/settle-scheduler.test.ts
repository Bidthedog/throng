import { describe, it, expect } from 'vitest';
import { createSettleScheduler, type SettleClock } from '../../src/preview/settle-scheduler.js';

/**
 * 044 T009 — when a parented preview shows a change (FR-022, FR-028, FR-060, FR-060a).
 *
 * A trailing debounce alone starves a preview while the user keeps typing; a maximum wait alone
 * re-renders on every keystroke burst. The scheduler is both, and the clock is injected so every
 * assertion here is about exact milliseconds rather than about a test that sleeps.
 */

interface FakeClock extends SettleClock {
  advance(ms: number): void;
  readonly time: number;
}

function fakeClock(): FakeClock {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    get time() {
      return time;
    },
    now: () => time,
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: time + Math.max(0, ms), callback });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const until = time + ms;
      for (;;) {
        let dueId: number | undefined;
        let dueAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= until && (t.at < dueAt || (t.at === dueAt && id < (dueId ?? Infinity)))) {
            dueId = id;
            dueAt = t.at;
          }
        }
        if (dueId === undefined) break;
        const timer = timers.get(dueId)!;
        timers.delete(dueId);
        time = timer.at;
        timer.callback();
      }
      time = until;
    },
  };
}

function setup(delayMs: number, maxWaitMs: number) {
  const clock = fakeClock();
  const settledAt: number[] = [];
  const scheduler = createSettleScheduler({
    delayMs,
    maxWaitMs,
    clock,
    onSettle: () => settledAt.push(clock.now()),
  });
  return { clock, scheduler, settledAt };
}

describe('createSettleScheduler — trailing debounce (FR-060)', () => {
  it('settles delayMs after a single change, once', () => {
    const { clock, scheduler, settledAt } = setup(300, 1000);
    scheduler.change();
    expect(scheduler.pending).toBe(true);
    clock.advance(299);
    expect(settledAt).toEqual([]);
    clock.advance(1);
    expect(settledAt).toEqual([300]);
    expect(scheduler.pending).toBe(false);
    clock.advance(5000);
    expect(settledAt).toEqual([300]);
  });

  it('restarts the delay on every change inside it', () => {
    const { clock, scheduler, settledAt } = setup(300, 1000);
    scheduler.change(); // t=0
    clock.advance(200);
    scheduler.change(); // t=200
    clock.advance(200);
    scheduler.change(); // t=400
    clock.advance(299);
    expect(settledAt).toEqual([]);
    clock.advance(1);
    expect(settledAt).toEqual([700]);
  });

  it('a zero delay settles on the next tick, not synchronously', () => {
    const { clock, scheduler, settledAt } = setup(0, 0);
    scheduler.change();
    expect(settledAt).toEqual([]);
    clock.advance(0);
    expect(settledAt).toEqual([0]);
  });
});

describe('createSettleScheduler — maximum wait under continuous changes (FR-022, FR-060a)', () => {
  it('forces a settle no later than maxWaitMs after the first unshown change', () => {
    const { clock, scheduler, settledAt } = setup(300, 1000);
    clock.advance(50);
    // A change every 100 ms — never a 300 ms gap, so the debounce alone would never fire.
    for (let t = 50; t < 2300; t += 100) {
      scheduler.change();
      clock.advance(100);
    }
    // First unshown change at 50 → forced at 1050. The change arriving on that same tick, just after
    // the settle, is the next unshown one → forced at 2050.
    expect(settledAt).toEqual([1050, 2050]);
  });

  it('a stored maximum wait below the delay behaves as equal to the delay', () => {
    const { clock, scheduler, settledAt } = setup(300, 100);
    scheduler.change();
    clock.advance(299);
    expect(settledAt).toEqual([]);
    clock.advance(1);
    expect(settledAt).toEqual([300]);
  });
});

describe('createSettleScheduler — flush and cancel (FR-028)', () => {
  it('flush settles immediately and clears what was pending', () => {
    const { clock, scheduler, settledAt } = setup(300, 1000);
    clock.advance(10);
    scheduler.change();
    scheduler.flush();
    expect(settledAt).toEqual([10]);
    expect(scheduler.pending).toBe(false);
    clock.advance(5000);
    expect(settledAt).toEqual([10]);
  });

  it('flush settles even with nothing pending — Refresh always re-reads', () => {
    const { scheduler, settledAt } = setup(300, 1000);
    scheduler.flush();
    expect(settledAt).toEqual([0]);
  });

  it('the max-wait window restarts after a flush', () => {
    const { clock, scheduler, settledAt } = setup(300, 1000);
    scheduler.change(); // t=0 — had the window NOT restarted, this would force a settle at 1000
    clock.advance(200);
    scheduler.flush(); // t=200
    for (let i = 0; i < 12; i += 1) {
      scheduler.change();
      clock.advance(100);
    }
    // First unshown change after the flush is at 200 → forced at 1200.
    expect(settledAt).toEqual([200, 1200]);
  });

  it('cancel drops a pending settle without settling', () => {
    const { clock, scheduler, settledAt } = setup(300, 1000);
    scheduler.change();
    scheduler.cancel();
    expect(scheduler.pending).toBe(false);
    clock.advance(5000);
    expect(settledAt).toEqual([]);
  });
});

describe('SC-002 — the delay leaves most of a one-second budget for rendering', () => {
  it('a 300 ms delay settles a change with at least 700 ms of a 1 s budget left', () => {
    const BUDGET_MS = 1000;
    const { clock, scheduler, settledAt } = setup(300, 1000);
    clock.advance(1234);
    const changedAt = clock.now();
    scheduler.change();
    clock.advance(BUDGET_MS);
    expect(settledAt).toHaveLength(1);
    expect(BUDGET_MS - (settledAt[0] - changedAt)).toBeGreaterThanOrEqual(700);
  });
});
