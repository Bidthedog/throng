/**
 * Issue #86 / 019 FR-010 — the layout half of the shutdown drain.
 *
 * The store's 400ms debounce is the write #86 is about, and a drain has to settle BOTH of its
 * halves. The armed half is obvious and was built first. The IN-FLIGHT half is the one that
 * hides: once the timer has fired, the store's `flushSave` has nothing pending and returns at
 * once, while `void client.save(…)` is still on the wire — so the drain acks, the terminate/leave
 * exit closes the window on the very next line (no beat behind it), and the write dies having
 * been REPORTED as drained. That is #86 again, wearing its own fix's clothes.
 *
 * These drive the module directly: it is deliberately free of React so both halves can be.
 */
import { describe, expect, it } from 'vitest';
import {
  registerLayoutFlusher,
  settleLayoutSaves,
  trackLayoutSave,
} from '../../src/renderer/state/layout-saves.js';

/** A promise plus its resolver — a save held open for exactly as long as the test wants. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Whether `p` has settled — the whole question a drain is asked, and the one an ack answers.
 *
 * The tie-breaker is a MACROTASK, so every microtask `p` owes gets to run first: a drain that is
 * merely a few `await`s deep must be reported settled, or this would answer "pending" for
 * everything and no assertion below could fail. A save held open by a `deferred` cannot settle
 * within it, which is the case these tests turn on.
 */
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('settled');
  return (
    (await Promise.race([
      p.then(() => marker),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ])) === marker
  );
}

describe('the layout drain (019 FR-010, issue #86)', () => {
  it('fires what is ARMED: a mounted flusher is called and awaited', async () => {
    const save = deferred();
    let called = 0;
    const off = registerLayoutFlusher(async () => {
      called += 1;
      await save.promise;
    });

    const settling = settleLayoutSaves();
    expect(called, 'the drain must ASK every registered flusher').toBe(1);
    expect(await isSettled(settling), 'the drain must not ack while a flush is outstanding').toBe(
      false,
    );

    save.resolve();
    await settling;
    off();
  });

  it('awaits a save that is already IN FLIGHT — the half the armed flush cannot see', async () => {
    // Exactly the store's shape: the 400ms timer has ALREADY fired, so it dropped its promise
    // here and left `flushSave` with nothing pending to report.
    const save = deferred();
    const off = registerLayoutFlusher(async () => {
      /* nothing pending: the timer fired a moment ago */
    });
    void trackLayoutSave(save.promise);

    const settling = settleLayoutSaves();
    expect(
      await isSettled(settling),
      'the drain must NOT ack while a save it started is still on the wire — acking here is the ' +
        'write loss #86 reports, with the drain reporting success',
    ).toBe(false);

    save.resolve();
    await settling;
    off();
  });

  it('a FAILED save settles the drain rather than wedging the close', async () => {
    const save = deferred();
    void trackLayoutSave(save.promise);

    const settling = settleLayoutSaves();
    save.reject(new Error('daemon gone'));

    // Resolves, does not reject: a write that cannot land is surfaced through the reload path,
    // and must never hold the app open.
    await expect(settling).resolves.toBeUndefined();
  });

  it('settles immediately in a window that owns no layout at all', async () => {
    // A preferences window hosts no provider and starts no save. Nothing pending is a resolved
    // promise, not a special case — which is what lets the drain name no windows.
    await expect(settleLayoutSaves()).resolves.toBeUndefined();
  });

  it('forgets a save once it has landed, so a later drain does not re-await it', async () => {
    const first = deferred();
    void trackLayoutSave(first.promise);
    first.resolve();
    await settleLayoutSaves();

    // A second drain, with nothing outstanding, must ack without waiting on the last one.
    expect(await isSettled(settleLayoutSaves())).toBe(true);
  });

  it('un-registers a flusher when its provider unmounts', async () => {
    let called = 0;
    const off = registerLayoutFlusher(async () => {
      called += 1;
    });
    off();

    await settleLayoutSaves();
    expect(called, 'an unmounted provider owns nothing and must not be asked').toBe(0);
  });
});
