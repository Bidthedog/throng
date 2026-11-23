import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabScroll } from '../../src/renderer/workspace/tab-scroll.js';

/**
 * MIGRATED FROM `packages/ui/tests/e2e/tab-scroll.e2e.ts` — `T052 — duration 0 is instant (A10)`,
 * `T052 — reduce motion forces an instant scroll, and does not rewrite the setting (A11, A12)` and
 * `T053 — reduce motion applied MID-FLIGHT settles the scroll immediately (A13)`.
 *
 * Layer: component — the decision is `instant = reduceMotion || !(durationMs > 0)` in `useTabScroll`, and
 * what it does to `scrollLeft` frame by frame. The E2Es sampled a real strip's `scrollLeft` in a real
 * window to see it; a stubbed `requestAnimationFrame`, a track object and a mocked `matchMedia` show the same
 * thing without a window. The smooth path (A1–A9) and the layout of the strip stay at E2E.
 */

const TARGET = 300;

/** A manually-driven animation-frame clock. */
let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let clock: number;
const pendingFrames = (): number => frames.size;
function runFrame(advanceMs: number): void {
  clock += advanceMs;
  const due = [...frames.entries()];
  frames.clear();
  for (const [, cb] of due) cb(clock);
}

/** A `matchMedia` whose reduce-motion answer can be flipped, firing `change` like the OS does. */
let reduce: boolean;
let listeners: Set<(e: MediaQueryListEvent) => void>;
function setReduceMotion(next: boolean): void {
  reduce = next;
  act(() => {
    for (const l of listeners) l({ matches: next } as MediaQueryListEvent);
  });
}

/** Everything the code under test reaches on `window.throng` (the config/IPC bridge). Must stay empty. */
let bridgeTouched: string[];

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  clock = 1000;
  reduce = false;
  listeners = new Set();
  bridgeTouched = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes('prefers-reduced-motion') && reduce;
      },
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
    }),
  });
  Reflect.set(
    window,
    'throng',
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          bridgeTouched.push(String(prop));
          return undefined;
        },
      },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(window, 'throng');
});

function mount(durationMs: number) {
  const track = document.createElement('div');
  return {
    track,
    ...renderHook(({ ms }: { ms: number }) => useTabScroll({ current: track }, ms), {
      initialProps: { ms: durationMs },
    }),
  };
}

describe('the instant path of the tab strip scroll', () => {
  it('animates when nothing asks otherwise — the control the instant cases are measured against', () => {
    const { track, result } = mount(400);
    expect(result.current.instant).toBe(false);

    act(() => result.current.scrollTo(TARGET));

    expect(track.scrollLeft, 'a smooth scroll does not jump on the first call').toBe(0);
    expect(pendingFrames()).toBe(1);
    act(() => runFrame(200));
    expect(track.scrollLeft).toBeGreaterThan(0);
    expect(track.scrollLeft).toBeLessThan(TARGET);
  });

  it('duration 0 is instant: the strip is at its target at once, with no frame ever scheduled (A10)', () => {
    const { track, result } = mount(0);

    expect(result.current.instant).toBe(true);
    act(() => result.current.scrollTo(TARGET));

    expect(track.scrollLeft).toBe(TARGET);
    expect(pendingFrames(), 'no animation loop was started').toBe(0);
  });

  it('reduce motion forces the instant path whatever the duration says, and issues no config write (A11, A12)', () => {
    reduce = true;
    const { track, result } = mount(1500);

    expect(result.current.instant).toBe(true);
    act(() => result.current.scrollTo(TARGET));

    expect(track.scrollLeft).toBe(TARGET);
    expect(pendingFrames()).toBe(0);
    // The preference is read from matchMedia and never written: the hook reached for no bridge, so no
    // settings write could have been issued.
    expect(bridgeTouched).toEqual([]);
  });

  it('reduce motion turning on MID-FLIGHT settles the scroll at its target at once (A13, A14)', () => {
    const { track, result } = mount(1500);
    act(() => result.current.scrollTo(TARGET));
    act(() => runFrame(300));
    // Non-vacuous: the glide is genuinely under way, part of the way and with a frame pending.
    expect(track.scrollLeft).toBeGreaterThan(0);
    expect(track.scrollLeft).toBeLessThan(TARGET);
    expect(pendingFrames()).toBe(1);

    setReduceMotion(true);

    expect(track.scrollLeft, 'it finished its journey rather than stopping where it was').toBe(TARGET);
    expect(pendingFrames(), 'the in-flight frame was cancelled').toBe(0);
    expect(result.current.instant).toBe(true);
    expect(result.current.pendingTarget()).toBeNull();
    expect(bridgeTouched).toEqual([]);
  });

  it('a duration changed to 0 mid-flight settles the same way (the other half of `instant`)', () => {
    const { track, result, rerender } = mount(1500);
    act(() => result.current.scrollTo(TARGET));
    act(() => runFrame(300));
    expect(track.scrollLeft).toBeLessThan(TARGET);

    rerender({ ms: 0 });

    expect(track.scrollLeft).toBe(TARGET);
    expect(pendingFrames()).toBe(0);
  });
});
