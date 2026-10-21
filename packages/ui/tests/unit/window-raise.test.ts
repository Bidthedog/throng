import { describe, it, expect } from 'vitest';
import { raiseWindow, type RaisableWindow } from '../../src/main/window-raise.js';

/**
 * 057 T039 — the restore / show / focus sequence a second launch used to carry inline, now shared with
 * "go to this panel" (FR-034). Recovering a window left on a disconnected monitor is part of it.
 */
function fakeWindow(opts: { minimized?: boolean; bounds?: { x: number; y: number; width: number; height: number } }) {
  const calls: string[] = [];
  const win: RaisableWindow = {
    getBounds: () => opts.bounds ?? { x: 0, y: 0, width: 800, height: 600 },
    setBounds: (b) => calls.push(`setBounds:${b.x},${b.y},${b.width},${b.height}`),
    isMinimized: () => opts.minimized ?? false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  return { win, calls };
}

const visibleEverywhere = {
  isVisible: () => true,
  clampToVisible: (b: { x: number; y: number; width: number; height: number }) => b,
};

describe('raiseWindow', () => {
  it('shows and focuses a visible, restored window without moving it', () => {
    const { win, calls } = fakeWindow({});
    raiseWindow(win, visibleEverywhere);
    expect(calls).toEqual(['show', 'focus']);
  });

  it('restores a minimised window before showing it', () => {
    const { win, calls } = fakeWindow({ minimized: true });
    raiseWindow(win, visibleEverywhere);
    expect(calls).toEqual(['restore', 'show', 'focus']);
  });

  it('moves a window left on a disconnected monitor onto a visible display first', () => {
    const { win, calls } = fakeWindow({ bounds: { x: 5000, y: 0, width: 800, height: 600 } });
    raiseWindow(win, {
      isVisible: () => false,
      clampToVisible: () => ({ x: 10, y: 20, width: 800, height: 600 }),
    });
    expect(calls).toEqual(['setBounds:10,20,800,600', 'show', 'focus']);
  });
});
