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
  it('raises the whole group (main + children) when any window is focused', () => {
    const wm = new WindowManager();
    const main = new FakeWindow();
    const a = new FakeWindow();
    const b = new FakeWindow();
    wm.registerMain(main);
    wm.registerChild('a', a);
    wm.registerChild('b', b);

    a.emit('focus'); // focusing a child raises everyone
    expect(main.moveTop).toHaveBeenCalledTimes(1);
    expect(a.moveTop).toHaveBeenCalledTimes(1);
    expect(b.moveTop).toHaveBeenCalledTimes(1);
  });

  it('raises the focused window last so it ends up on top of the group', () => {
    const wm = new WindowManager();
    const order: string[] = [];
    const main = new FakeWindow();
    const a = new FakeWindow();
    main.moveTop = vi.fn(() => order.push('main'));
    a.moveTop = vi.fn(() => order.push('a'));
    wm.registerMain(main);
    wm.registerChild('a', a);

    main.emit('focus'); // focusing main → main must be raised LAST (on top)
    expect(order.at(-1)).toBe('main');

    order.length = 0;
    a.emit('focus'); // focusing the child → the child ends up on top, not the main
    expect(order.at(-1)).toBe('a');
  });

  it('does not raise a minimised window (independent minimise)', () => {
    const wm = new WindowManager();
    const main = new FakeWindow();
    const child = new FakeWindow();
    wm.registerMain(main);
    wm.registerChild('c', child);
    child.minimized = true;

    main.emit('focus');
    expect(main.moveTop).toHaveBeenCalledTimes(1);
    expect(child.moveTop).not.toHaveBeenCalled(); // stays minimised
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
    const main = new FakeWindow();
    const child = new FakeWindow();
    // Simulate moveTop re-emitting focus (which would loop without the guard).
    child.moveTop = vi.fn(() => child.emit('focus'));
    wm.registerMain(main);
    wm.registerChild('c', child);

    expect(() => main.emit('focus')).not.toThrow();
    expect(child.moveTop).toHaveBeenCalledTimes(1); // guard prevents re-entry
  });
});
