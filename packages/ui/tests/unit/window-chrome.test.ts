/**
 * The chrome of throng's secondary windows (070 FR-026). On macOS the title bar draws no controls of its own and the
 * native traffic lights stand in, so a window throng offers fewer controls must grey the lights it does not offer,
 * or Preferences, About and the Resource Monitor could be minimised, zoomed or taken full screen apart from their
 * parent. Windows and Linux keep exactly the options they had.
 */
import { describe, expect, it } from 'vitest';
import { secondaryWindowChrome } from '../../src/main/window-chrome.js';

const FRAMELESS = { frame: false } as const;
const MAC = { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 11 } } as const;

describe('secondaryWindowChrome', () => {
  it('greys every light but close for a close-only window on macOS', () => {
    expect(secondaryWindowChrome(MAC, 'macos', { maximise: false })).toEqual({
      ...MAC,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
    });
  });

  it('keeps zoom for a window that offers maximise, but never full screen apart from its parent', () => {
    expect(secondaryWindowChrome(MAC, 'macos', { maximise: true })).toEqual({
      ...MAC,
      minimizable: false,
      fullscreenable: false,
    });
  });

  it('leaves Windows and Linux exactly as they were', () => {
    expect(secondaryWindowChrome(FRAMELESS, 'windows', { maximise: false })).toEqual(FRAMELESS);
    expect(secondaryWindowChrome(FRAMELESS, 'linux', { maximise: true })).toEqual(FRAMELESS);
  });
});
