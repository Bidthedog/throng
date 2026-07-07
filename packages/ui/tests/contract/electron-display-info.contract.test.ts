import type { Display } from 'electron';
import { describe, it, expect } from 'vitest';
import { runDisplayInfoContract } from '@throng/core/testing';
import { ElectronDisplayInfo } from '../../src/main/electron-display-info.js';

// A fake display source stands in for Electron `screen` (only available in the
// real main process); the geometry under test is delegated to the pure core
// implementation, which is what ElectronDisplayInfo uses at runtime.
const fakeDisplays = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 } },
] as unknown as Display[];

describe('ElectronDisplayInfo', () => {
  it('satisfies the shared IDisplayInfo contract', () => {
    expect(() =>
      runDisplayInfoContract(() => new ElectronDisplayInfo(() => fakeDisplays)),
    ).not.toThrow();
  });

  it('repositions an off-screen window onto a connected display (FR-028)', () => {
    const info = new ElectronDisplayInfo(() => fakeDisplays);
    const offscreen = { x: -5000, y: -5000, width: 800, height: 600 };
    expect(info.isVisible(offscreen)).toBe(false);
    const clamped = info.clampToVisible(offscreen);
    expect(info.isVisible(clamped)).toBe(true);
    expect(clamped.displayId).toBe('1');
  });
});
