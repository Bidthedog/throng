import { describe, expect, it } from 'vitest';
import { wireFloatingLayering, yieldFloatingWindows, type LayeringSeam } from '../../src/main/floating-window-layering.js';

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
  // 069: Open folder from Preferences — the file manager must come up above it, not behind.
  it('yields to another application\'s window until throng has lost focus once', () => {
    const f = fakes(true);
    const unwire = wireFloatingLayering(f.win, f.seam);
    f.flush();
    yieldFloatingWindows();
    expect(f.top()).toBe(false);
    f.focusChanged(true); // throng still focused: the file manager has not taken focus yet
    expect(f.top()).toBe(false);
    f.focusChanged(false); // the user is in the file manager
    expect(f.top()).toBe(false);
    f.focusChanged(true); // back in throng: above its windows again
    expect(f.top()).toBe(true);
    unwire();
  });

  /**
   * X11: `isAlwaysOnTop()` is Chromium's cache of `_NET_WM_STATE_ABOVE`, and every `_NET_WM_STATE`
   * PropertyNotify re-reads it from the server — including one for an unrelated atom, such as
   * xfwm4 clearing `_NET_WM_STATE_FOCUSED` on the window losing focus. So between a
   * `setAlwaysOnTop(false)` and the window manager applying it, the cache can read `true` again;
   * a re-raise that trusted it was skipped, and the drop then landed with nothing left to undo it.
   * Seen as the monitor below throng after Activate (resource-monitor.e2e.ts, hosted Linux).
   */
  it('re-raises after a drop the window manager has not applied yet, whatever the cache says', () => {
    const f = fakes(true);
    let server = false; // _NET_WM_STATE_ABOVE as the window manager holds it
    let cache = false; // Chromium's is_always_on_top_
    const pending: boolean[] = []; // client messages the window manager has not processed
    const propertyNotify = (): void => {
      cache = server;
    };
    const wm = {
      isDestroyed: () => false,
      isAlwaysOnTop: () => cache,
      setAlwaysOnTop: (v: boolean) => {
        cache = v;
        pending.push(v);
      },
    };
    const applyPending = (): void => {
      while (pending.length > 0) {
        server = pending.shift()!;
        propertyNotify();
      }
    };
    wireFloatingLayering(wm, f.seam);
    f.flush();
    applyPending();
    expect(server).toBe(true);

    f.focusChanged(false); // the monitor's blur, before the main window's focus has arrived
    propertyNotify(); // _NET_WM_STATE_FOCUSED cleared on the monitor: the cache re-reads ABOVE
    f.focusChanged(true); // the main window's focus
    applyPending();

    expect(server, 'the window manager left the monitor below throng').toBe(true);
    expect(wm.isAlwaysOnTop()).toBe(true);
  });

  it('stops yielding once unwired', () => {
    const f = fakes(true);
    const unwire = wireFloatingLayering(f.win, f.seam);
    f.flush();
    unwire();
    f.win.setAlwaysOnTop(true);
    yieldFloatingWindows();
    expect(f.top()).toBe(true);
  });
});
