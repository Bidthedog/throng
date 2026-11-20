import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESIZE_SETTLE_MS, RESIZING_CLASS, holdWidthWhileResizing } from '../../src/renderer/preview/resize-freeze.js';

/**
 * 075 SC-006 (2026-11-20) — a long document is laid out once when its panel is resized, not once per frame of the
 * drag: the body keeps its width while the panel's keeps changing, and takes the new one once the resize settles.
 *
 * Layer: component — the subject is two elements' styles under a ResizeObserver (a stand-in jsdom lacks).
 */
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

let scroller: HTMLElement;
let content: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  scroller = document.createElement('div');
  content = document.createElement('div');
  scroller.append(content);
  document.body.append(scroller);
});

afterEach(() => {
  scroller.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('holding a body\'s width while its panel is resized', () => {
  it('never holds while a dialog is open inside the body: the hold would confine its window-wide overlay', () => {
    // An OS window-edge resize or an animated maximise changes the width in bursts too, with a dialog open.
    holdWidthWhileResizing(scroller, content);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    content.append(overlay);
    observed!(800);
    observed!(780);
    observed!(760);
    expect(content.style.width).toBe('');
    expect(content.classList.contains(RESIZING_CLASS)).toBe(false);
    // Closed: the next burst holds again.
    overlay.remove();
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    observed!(740);
    observed!(720);
    expect(content.classList.contains(RESIZING_CLASS)).toBe(true);
  });

  it('leaves the first measurement alone', () => {
    holdWidthWhileResizing(scroller, content);
    observed!(800);
    expect(content.style.width).toBe('');
    expect(content.classList.contains(RESIZING_CLASS)).toBe(false);
  });

  it('reflows at once for a single width change — a scrollbar, a notice, a maximise', () => {
    holdWidthWhileResizing(scroller, content);
    observed!(800);
    observed!(780);
    expect(content.style.width).toBe('');
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    observed!(760);
    expect(content.style.width).toBe('');
    expect(content.classList.contains(RESIZING_CLASS)).toBe(false);
  });

  it('holds the width a drag began at while it keeps changing, then takes the new one once it settles', () => {
    holdWidthWhileResizing(scroller, content);
    observed!(800);
    observed!(780);
    // A second change hard on the first is a drag: the body keeps the width it was just laid out for.
    observed!(760);
    expect(content.style.width).toBe('780px');
    expect(content.style.boxSizing).toBe('border-box');
    expect(content.classList.contains(RESIZING_CLASS)).toBe(true);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS - 1);
    observed!(740);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS - 1);
    expect(content.style.width).toBe('780px');
    vi.advanceTimersByTime(1);
    expect(content.style.width).toBe('');
    expect(content.style.boxSizing).toBe('');
    expect(content.classList.contains(RESIZING_CLASS)).toBe(false);
  });

  it('ignores a change of height alone', () => {
    holdWidthWhileResizing(scroller, content);
    observed!(800);
    observed!(800);
    expect(content.style.width).toBe('');
  });

  it('lets go when it is disposed mid-resize', () => {
    const dispose = holdWidthWhileResizing(scroller, content);
    observed!(800);
    observed!(700);
    observed!(650);
    expect(content.style.width).toBe('700px');
    dispose();
    expect(content.style.width).toBe('');
    expect(content.classList.contains(RESIZING_CLASS)).toBe(false);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(content.style.width).toBe('');
  });
});
