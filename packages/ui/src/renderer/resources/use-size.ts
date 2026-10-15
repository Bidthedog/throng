/**
 * An element's size, from ONE shared `ResizeObserver` for every sized element in the monitor
 * (Principle XII: observers are not free, and a treemap per section must not each cost one).
 *
 * jsdom has no layout and no `ResizeObserver`: a component then keeps the fallback size, which is also
 * what a first paint uses before the observer reports.
 */
import { useCallback, useState } from 'react';

export interface Size {
  readonly width: number;
  readonly height: number;
}

const watchers = new Map<Element, (size: Size) => void>();
let shared: ResizeObserver | null = null;

function observer(): ResizeObserver | null {
  if (shared !== null) return shared;
  if (typeof ResizeObserver === 'undefined') return null;
  shared = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      watchers.get(entry.target)?.({ width: Math.round(width), height: Math.round(height) });
    }
  });
  return shared;
}

/**
 * `[ref, size]`: attach `ref` to the element; `size` follows it, starting at `fallback`.
 *
 * The element is MEASURED when it is attached — in the commit, before the first paint — so a first layout
 * is done in the box the element really has. Left to the observer alone, the first layout is done for
 * `fallback` and again, a frame later, for the truth (D5).
 */
export function useElementSize<T extends Element>(fallback: Size): [(el: T | null) => (() => void) | void, Size] {
  const [size, setSize] = useState<Size>(fallback);
  const ref = useCallback((el: T | null) => {
    if (el === null) return;
    const update = (next: Size): void =>
      setSize((prev) => (prev.width === next.width && prev.height === next.height || next.width === 0 || next.height === 0 ? prev : next));
    const box = el.getBoundingClientRect();
    update({ width: Math.round(box.width), height: Math.round(box.height) });
    const watch = observer();
    if (watch === null) return;
    watchers.set(el, update);
    watch.observe(el);
    return () => {
      watch.unobserve(el);
      watchers.delete(el);
    };
  }, []);
  return [ref, size];
}
