import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerTerminalToggles,
  runTerminalToggle,
} from '../../src/renderer/terminal/terminal-toggle-registry.js';

/**
 * 076 FR-006, research R6 — the window dispatcher runs a toggle command on the focused terminal through this
 * registry, which each mounted terminal panel fills with its own flip.
 */
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('the terminal toggle registry (076)', () => {
  it('runs the registered panel’s flip for that toggle, and reports it ran', () => {
    const flip = vi.fn();
    cleanups.push(registerTerminalToggles('p1', flip));
    expect(runTerminalToggle('p1', 'notifications')).toBe(true);
    expect(flip).toHaveBeenCalledWith('notifications');
  });

  it('reports nothing to run for a panel with no terminal registered, or once it has unregistered', () => {
    expect(runTerminalToggle('nope', 'rememberCommand')).toBe(false);
    const flip = vi.fn();
    const off = registerTerminalToggles('p2', flip);
    off();
    expect(runTerminalToggle('p2', 'rememberCommand')).toBe(false);
    expect(flip).not.toHaveBeenCalled();
  });

  it('an old registration’s clean-up leaves a newer one for the same panel in place', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerTerminalToggles('p3', first);
    cleanups.push(registerTerminalToggles('p3', second));
    offFirst();
    expect(runTerminalToggle('p3', 'rememberDirectory')).toBe(true);
    expect(second).toHaveBeenCalledWith('rememberDirectory');
    expect(first).not.toHaveBeenCalled();
  });
});
