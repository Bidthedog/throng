import { describe, expect, it } from 'vitest';
import { wireFloatingLayering, type LayeringSeam } from '../../src/main/floating-window-layering.js';

/**
 * 055 T104, FR-083 — a floating window (Preferences, the Resource Monitor) is above throng's own windows
 * while throng has focus, and never above another application's.
 *
 * Layer: unit — the rule is "hold `alwaysOnTop` exactly while a throng window has focus"; the seam
 * stands in for Electron's focus events, which need no real window to drive.
 */
function fakes(focused: boolean) {
  let hasFocus = focused;
  const listeners = new Set<() => void>();
  const deferred: (() => void)[] = [];
  const seam: LayeringSeam = {
    onFocusChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    throngHasFocus: () => hasFocus,
    defer: (fn) => deferred.push(fn),
  };
  let top = false;
  let destroyed = false;
  const win = {
    isDestroyed: () => destroyed,
    isAlwaysOnTop: () => top,
    setAlwaysOnTop: (v: boolean) => {
      top = v;
    },
  };
  const flush = (): void => {
    while (deferred.length > 0) deferred.shift()!();
  };
  const focusChanged = (now: boolean): void => {
    hasFocus = now;
    for (const l of listeners) l();
    flush();
  };
  return { seam, win, flush, focusChanged, top: () => top, listeners, destroy: () => (destroyed = true) };
}

describe('floating-window layering (055 FR-083)', () => {
  it('is above throng while a throng window has focus', () => {
    const f = fakes(true);
    wireFloatingLayering(f.win, f.seam);
    f.flush();
    expect(f.top()).toBe(true);
  });

  it('drops below another application when throng loses focus, and returns when it comes back', () => {
    const f = fakes(true);
    wireFloatingLayering(f.win, f.seam);
    f.flush();
    f.focusChanged(false);
    expect(f.top()).toBe(false);
    f.focusChanged(true);
    expect(f.top()).toBe(true);
  });

  it('reads focus on the next tick, so the gap between two throng windows does not flicker', () => {
    const f = fakes(true);
    wireFloatingLayering(f.win, f.seam);
    f.flush();
    for (const l of f.listeners) l();
    expect(f.top()).toBe(true);
  });

  it('stops listening and drops the flag when unwired', () => {
    const f = fakes(true);
    const unwire = wireFloatingLayering(f.win, f.seam);
    f.flush();
    unwire();
    expect(f.top()).toBe(false);
    expect(f.listeners.size).toBe(0);
  });

  it('leaves a destroyed window alone', () => {
    const f = fakes(true);
    wireFloatingLayering(f.win, f.seam);
    f.destroy();
    f.flush();
    expect(f.top()).toBe(false);
  });
});
