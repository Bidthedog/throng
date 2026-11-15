/**
 * The Resource Monitor's minimise on macOS (055 FR-085, 070 FR-026). The title bar draws no controls on macOS, so the
 * native yellow light is the monitor's minimise, and it must send the monitor to the status bar as throng's own
 * Minimise button does elsewhere — never leave it in the Dock. Electron's `minimize` event cannot be cancelled, so
 * throng finishes it: the window is remembered and closed, the reduced-motion form of the shrink (macOS has just
 * animated it). Windows and Linux keep their button and a window that cannot minimise.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { monitorWindowChrome, routeMonitorMinimise } from '../../src/main/window-chrome.js';

const FRAMELESS = { frame: false } as const;
const MAC = { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } } as const;

describe('the Resource Monitor window’s minimise', () => {
  it('lets the yellow light minimise on macOS, and greys only full screen', () => {
    expect(monitorWindowChrome(MAC, 'macos')).toEqual({ ...MAC, minimizable: true, fullscreenable: false });
  });

  it('keeps the window unminimisable on Windows and Linux, where its own button minimises it', () => {
    expect(monitorWindowChrome(FRAMELESS, 'windows')).toEqual({ ...FRAMELESS, minimizable: false });
    expect(monitorWindowChrome(FRAMELESS, 'linux')).toEqual({ ...FRAMELESS, minimizable: false });
  });

  it('sends the monitor to the status bar when macOS minimises it', () => {
    const win = new EventEmitter();
    const minimise = vi.fn();
    routeMonitorMinimise(win, 'macos', minimise);
    win.emit('minimize');
    expect(minimise).toHaveBeenCalledExactlyOnceWith({ reducedMotion: true });
  });

  it('routes nothing on Windows and Linux', () => {
    for (const os of ['windows', 'linux'] as const) {
      const win = new EventEmitter();
      routeMonitorMinimise(win, os, vi.fn());
      expect(win.listenerCount('minimize')).toBe(0);
    }
  });
});
