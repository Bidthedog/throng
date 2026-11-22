/**
 * 075 SC-006, amended 2026-11-20 (the maintainer: "Can we make previews resize dynamically / on the fly again, but
 * just reduce the amount of redraws … Alternatively, apply the resize debounce on previews over a certain size
 * instead, and keep the dynamic resize for smaller previews?") — both, by measured cost.
 *
 * A preview's body follows its panel live while a drag lasts, one width applied per animation frame. It is held at
 * its width (the settle path `preview-resize-freeze.test.ts` covers) only while what the last width change cost — the
 * frame it was drawn in, beyond an ordinary frame — exceeds {@link RESIZE_FRAME_BUDGET_MS}; each settle measures again.
 *
 * Layer: component — the decision as a pure function, and the observer over two jsdom elements, driven through injected frames and a stand-in
 * ResizeObserver, so the frame timing is the test's to choose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESIZE_FRAME_BUDGET_MS,
  RESIZE_SETTLE_MS,
  RESIZING_CLASS,
  frameCost,
  holdWidthWhileResizing,
  type ResizeFrames,
} from '../../src/renderer/preview/resize-freeze.js';

describe('the decision', () => {
  it('charges a change with what its frame took beyond an ordinary frame', () => {
    expect(frameCost(16.7, 16.7)).toBe(0);
    expect(frameCost(50, 16.7)).toBeCloseTo(33.3);
    // A frame shorter than the estimate is free, never negative.
    expect(frameCost(8, 16.7)).toBe(0);
  });

  it('the bound is one 60 Hz frame of extra work', () => {
    expect(RESIZE_FRAME_BUDGET_MS).toBe(16);
  });
});

/* ── Driving it: a stand-in observer and frames the test advances ─────────────────────────────── */

let observed: ((width: number) => void) | null = null;
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    observed = (width) => this.callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect(): void {
    observed = null;
  }
  unobserve(): void {}
}

/** Frames the test runs: `frame(ms)` runs every queued callback at a clock `ms` later than the last frame. */
function manualFrames() {
  let clock = 0;
  let next = 1;
  let queue = new Map<number, FrameRequestCallback>();
  const frames: ResizeFrames = {
    request: (cb) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancel: (id) => void queue.delete(id),
  };
  return {
    frames,
    pending: () => queue.size,
    frame(afterMs: number): void {
      clock += afterMs;
      const run = queue;
      queue = new Map();
      for (const cb of run.values()) cb(clock);
    },
  };
}

let panel: HTMLElement;
let body: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  panel = document.createElement('div');
  body = document.createElement('div');
  panel.append(body);
  document.body.append(panel);
});
afterEach(() => {
  panel.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CHEAP = 16.7; // an ordinary 60 Hz frame
const DEAR = 16.7 + RESIZE_FRAME_BUDGET_MS + 10; // a frame that took more than a frame's work extra

describe('live while the layout is cheap', () => {
  // The first observation is the panel's width; the first change reflows at once; a second change hard on it is a drag.
  it('follows the panel during a drag, applying only the latest width, once per frame', () => {
    const f = manualFrames();
    holdWidthWhileResizing(panel, body, { frames: f.frames });
    observed!(800);
    observed!(780);
    observed!(760); // the drag: live, pinned at the width the panel has just been laid out for
    expect(body.style.width).toBe('760px');
    expect(body.classList.contains(RESIZING_CLASS)).toBe(false);
    observed!(740);
    observed!(720); // two changes before the next frame
    expect(body.style.width).toBe('760px');
    f.frame(CHEAP); // one apply, of the latest
    expect(body.style.width).toBe('720px');
    observed!(700);
    f.frame(CHEAP);
    expect(body.style.width).toBe('700px');
    expect(body.classList.contains(RESIZING_CLASS)).toBe(false);
    // Settled: the body fills the panel again, as it does at rest.
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(body.style.width).toBe('');
  });

  it('never applies a width between frames, however many changes arrive', () => {
    const f = manualFrames();
    holdWidthWhileResizing(panel, body, { frames: f.frames });
    observed!(800);
    observed!(780);
    observed!(760);
    const seen = new Set<string>();
    for (const w of [750, 740, 730, 720, 710]) {
      observed!(w);
      seen.add(body.style.width);
    }
    expect([...seen]).toEqual(['760px']);
    expect(f.pending()).toBe(1);
    f.frame(CHEAP);
    expect(body.style.width).toBe('710px');
  });
});

describe('held while the layout is dear', () => {
  it('holds for the rest of the drag once two applies in a row each cost more than the budget', () => {
    const f = manualFrames();
    holdWidthWhileResizing(panel, body, { frames: f.frames });
    observed!(800);
    observed!(780);
    observed!(760);
    observed!(740);
    f.frame(CHEAP); // applies 740
    observed!(720);
    f.frame(DEAR); // 740's frame was dear; applies 720
    expect(body.classList.contains(RESIZING_CLASS)).toBe(false);
    observed!(700);
    f.frame(DEAR); // 720's frame was dear too: held from here, at the width last applied
    expect(body.classList.contains(RESIZING_CLASS)).toBe(true);
    expect(body.style.width).toBe('720px');
    observed!(680);
    f.frame(CHEAP);
    expect(body.style.width).toBe('720px');
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(body.style.width).toBe('');
    expect(body.classList.contains(RESIZING_CLASS)).toBe(false);
  });

  it('one dear frame alone — a collection, a stray task — does not hold', () => {
    const f = manualFrames();
    holdWidthWhileResizing(panel, body, { frames: f.frames });
    observed!(800);
    observed!(780);
    observed!(760);
    observed!(740);
    f.frame(CHEAP);
    observed!(720);
    f.frame(DEAR);
    observed!(700);
    f.frame(CHEAP);
    observed!(680);
    f.frame(CHEAP);
    expect(body.classList.contains(RESIZING_CLASS)).toBe(false);
    expect(body.style.width).toBe('680px');
  });

  it('starts the next drag held, and goes live again once a settle measures the document cheap', () => {
    const f = manualFrames();
    holdWidthWhileResizing(panel, body, { frames: f.frames, initialCostMs: RESIZE_FRAME_BUDGET_MS + 1 });
    // Known dear: the drag holds at once, as before the amendment.
    observed!(800);
    observed!(780);
    observed!(760);
    expect(body.style.width).toBe('780px');
    expect(body.classList.contains(RESIZING_CLASS)).toBe(true);
    // The settle lets go, and the frame that draws the new width is measured: cheap now.
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(body.style.width).toBe('');
    f.frame(CHEAP); // the frame the release is drawn in begins
    f.frame(CHEAP); // and ends: cheap
    // The next drag is live.
    observed!(740);
    observed!(720);
    observed!(700);
    f.frame(CHEAP);
    expect(body.classList.contains(RESIZING_CLASS)).toBe(false);
    expect(body.style.width).toBe('700px');
  });

  it('a settle that measures the document dear keeps the next drag held', () => {
    const f = manualFrames();
    holdWidthWhileResizing(panel, body, { frames: f.frames, initialCostMs: RESIZE_FRAME_BUDGET_MS + 1 });
    observed!(800);
    observed!(780);
    observed!(760);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    f.frame(CHEAP);
    f.frame(DEAR);
    observed!(740);
    observed!(720);
    expect(body.classList.contains(RESIZING_CLASS)).toBe(true);
  });
});
