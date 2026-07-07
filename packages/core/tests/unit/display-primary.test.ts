import { describe, it, expect } from 'vitest';
import { createStaticDisplayInfo } from '../../src/display/static-display-info.js';
import type { DisplayDescriptor } from '../../src/abstractions/display-info.js';

// Reproduces the reported "npm start does nothing" multi-monitor layout: a primary
// display at the origin with a second monitor positioned ABOVE it. A fresh window
// must centre on the PRIMARY (origin) display, never the top monitor.
const layout: DisplayDescriptor[] = [
  // Deliberately NOT origin-first, to prove primary is found by position not order.
  { id: 'top', bounds: { x: 0, y: -1440, width: 2560, height: 1440 } },
  { id: 'left', bounds: { x: -1440, y: -737, width: 1440, height: 2560 } },
  { id: 'primary', bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
];

describe('display primary placement (multi-monitor "does nothing" fix)', () => {
  const di = createStaticDisplayInfo(layout);

  it('primaryBounds() is the display at the desktop origin', () => {
    expect(di.primaryBounds()).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
  });

  it('centerOnPrimary() centres a fresh window on the primary display (never negative y)', () => {
    const b = di.centerOnPrimary(1200, 800);
    expect(b).toEqual({
      x: 0 + Math.floor((2560 - 1200) / 2),
      y: 0 + Math.floor((1440 - 800) / 2),
      width: 1200,
      height: 800,
      displayId: 'primary',
    });
    expect(b.y).toBeGreaterThanOrEqual(0); // NOT on the top monitor (y=-1440)
    expect(di.isVisible(b)).toBe(true);
  });

  it('clampToVisible() moves an off-screen window onto the primary (origin) display', () => {
    const clamped = di.clampToVisible({ x: 9_000_000, y: 9_000_000, width: 800, height: 600 });
    expect(clamped.displayId).toBe('primary');
    expect(clamped.y).toBeGreaterThanOrEqual(0);
    expect(di.isVisible(clamped)).toBe(true);
  });

  it('falls back to the first display when none is at the origin', () => {
    const noOrigin = createStaticDisplayInfo([
      { id: 'a', bounds: { x: 100, y: 100, width: 800, height: 600 } },
    ]);
    expect(noOrigin.primaryBounds()).toEqual({ x: 100, y: 100, width: 800, height: 600 });
  });
});
