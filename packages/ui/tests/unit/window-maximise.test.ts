import { describe, expect, it } from 'vitest';
import { WindowMaximise, mustEmulateMaximise, type MaximiseTarget, type Rect } from '../../src/main/window-maximise.js';

/** A window whose `maximize()` does nothing, as Mutter treats a parented window under X11. */
function fakeWindow(opts: { parent: boolean; id?: number }): MaximiseTarget & { bounds: Rect; native: boolean; told: boolean[] } {
  const w = {
    id: opts.id ?? 1,
    bounds: { x: 100, y: 80, width: 780, height: 640 },
    native: false,
    told: [] as boolean[],
    isMaximized: () => w.native,
    maximize: () => {
      if (!opts.parent) w.native = true;
    },
    unmaximize: () => {
      w.native = false;
    },
    getBounds: () => ({ ...w.bounds }),
    setBounds: (b: Rect) => {
      w.bounds = { ...b };
    },
    workArea: () => ({ x: 0, y: 32, width: 2560, height: 1408 }),
    hasParent: () => opts.parent,
    notify: (m: boolean) => {
      w.told.push(m);
    },
  };
  return w;
}

describe('maximise from the custom title bar (007 FR-002/004)', () => {
  it('maximises a parented window on Linux by hand, and restores its bounds', () => {
    const max = new WindowMaximise('linux');
    const win = fakeWindow({ parent: true });
    max.toggle(win);
    expect(win.bounds).toEqual({ x: 0, y: 32, width: 2560, height: 1408 });
    expect(max.isMaximized(win)).toBe(true);
    max.toggle(win);
    expect(win.bounds).toEqual({ x: 100, y: 80, width: 780, height: 640 });
    expect(max.isMaximized(win)).toBe(false);
    expect(win.told).toEqual([true, false]);
  });

  it('leaves every other window to the window manager', () => {
    const max = new WindowMaximise('linux');
    const win = fakeWindow({ parent: false });
    max.toggle(win);
    expect(win.native).toBe(true);
    expect(win.bounds).toEqual({ x: 100, y: 80, width: 780, height: 640 });
    max.toggle(win);
    expect(win.native).toBe(false);
    expect(win.told).toEqual([]);
  });

  it('emulates only for a parented window on Linux', () => {
    expect(mustEmulateMaximise('linux', true)).toBe(true);
    expect(mustEmulateMaximise('linux', false)).toBe(false);
    expect(mustEmulateMaximise('win32', true)).toBe(false);
    // macOS draws no maximise of throng's own: the native zoom light maximises a parented window (070 FR-026).
    expect(mustEmulateMaximise('darwin', true)).toBe(false);
  });

  it('forgets a closed window, so a new window with its id starts unmaximised', () => {
    const max = new WindowMaximise('linux');
    max.toggle(fakeWindow({ parent: true, id: 7 }));
    max.forget(7);
    expect(max.isMaximized(fakeWindow({ parent: true, id: 7 }))).toBe(false);
  });
});
