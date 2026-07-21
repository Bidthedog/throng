import { describe, it, expect, vi } from 'vitest';
import { WindowManager, type ManagedWindow } from '../../src/main/window-manager.js';

class FakeWindow implements ManagedWindow {
  destroyed = false;
  minimized = false;
  moveTop = vi.fn();
  close = vi.fn(() => {
    this.destroyed = true;
    this.emit('closed');
  });
  private handlers: Record<string, Array<() => void>> = {};
  isDestroyed = (): boolean => this.destroyed;
  isMinimized = (): boolean => this.minimized;
  on(event: 'focus' | 'closed', listener: () => void): void {
    (this.handlers[event] ??= []).push(listener);
  }
  emit(event: 'focus' | 'closed'): void {
    for (const h of this.handlers[event] ?? []) h();
  }
}

describe('WindowManager', () => {
  it('raises ONLY the focused sub-workspace window, leaving the main window untouched (#138)', () => {
    const wm = new WindowManager();
    const main = new FakeWindow();
    const a = new FakeWindow();
    const b = new FakeWindow();
    wm.registerMain(main);
    wm.registerChild('a', a);
    wm.registerChild('b', b);

    a.emit('focus'); // activating a child must NOT drag the main window (or siblings) forward
    expect(a.moveTop).toHaveBeenCalledTimes(1);
    expect(main.moveTop).not.toHaveBeenCalled();
    expect(b.moveTop).not.toHaveBeenCalled();
  });

  it('raises ONLY the main window when it is focused, leaving sub-workspaces untouched (#138)', () => {
    const wm = new WindowManager();
    const main = new FakeWindow();
    const a = new FakeWindow();
    const b = new FakeWindow();
    wm.registerMain(main);
    wm.registerChild('a', a);
    wm.registerChild('b', b);

    main.emit('focus'); // the main window is independent too — its focus raises only itself
    expect(main.moveTop).toHaveBeenCalledTimes(1);
    expect(a.moveTop).not.toHaveBeenCalled();
    expect(b.moveTop).not.toHaveBeenCalled();
  });

  it('does not raise a minimised window (independent minimise)', () => {
    const wm = new WindowManager();
    const main = new FakeWindow();
    const child = new FakeWindow();
    wm.registerMain(main);
    wm.registerChild('c', child);
    child.minimized = true;

    child.emit('focus'); // even when focused, a minimised window is not moved to the top
    expect(child.moveTop).not.toHaveBeenCalled();

    main.emit('focus');
    expect(main.moveTop).toHaveBeenCalledTimes(1);
  });

  it('closes all sub-workspace windows when the main window closes', () => {
    const wm = new WindowManager();
    const main = new FakeWindow();
    const a = new FakeWindow();
    const b = new FakeWindow();
    wm.registerMain(main);
    wm.registerChild('a', a);
    wm.registerChild('b', b);

    main.emit('closed');
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(wm.childCount()).toBe(0);
  });

  it('tracks/untracks children and supports the lazy-reopen guard', () => {
    const wm = new WindowManager();
    const child = new FakeWindow();
    wm.registerChild('sw1', child);
    expect(wm.hasChild('sw1')).toBe(true);
    expect(wm.getChild('sw1')).toBe(child);

    child.emit('closed'); // a child closing untracks itself
    expect(wm.hasChild('sw1')).toBe(false);
    expect(wm.childCount()).toBe(0);
  });

  it('orders children topmost-first by most-recent focus (drop hit-test)', () => {
    const wm = new WindowManager();
    const a = new FakeWindow();
    const b = new FakeWindow();
    wm.registerChild('a', a);
    wm.registerChild('b', b);
    // Registering b last puts it on top.
    expect(wm.childIdsByFocus()).toEqual(['b', 'a']);

    // Focusing a brings it to the front.
    a.emit('focus');
    expect(wm.childIdsByFocus()).toEqual(['a', 'b']);
  });

  it('does not infinitely recurse if moveTop re-fires focus', () => {
    const wm = new WindowManager();
    const child = new FakeWindow();
    // Simulate moveTop re-emitting focus on the same window (which would loop
    // without the guard, since each window's focus now raises itself).
    child.moveTop = vi.fn(() => child.emit('focus'));
    wm.registerChild('c', child);

    expect(() => child.emit('focus')).not.toThrow();
    expect(child.moveTop).toHaveBeenCalledTimes(1); // guard prevents re-entry
  });
});
