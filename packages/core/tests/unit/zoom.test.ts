import { describe, it, expect } from 'vitest';
import {
  ZOOM_STEP,
  ZOOM_MIN_LEVEL,
  ZOOM_MAX_LEVEL,
  clampZoomLevel,
  zoomFactor,
  stepZoomLevel,
} from '@throng/core';

// 012 US2 (FR-011, contracts/zoom.md): the shared zoom range reused by the global
// zoom (main.ts) and per-type zoom, so the two behave identically.

describe('shared zoom range (config/zoom.ts)', () => {
  it('matches the global-zoom step and bounds', () => {
    expect(ZOOM_STEP).toBe(0.5);
    expect(ZOOM_MIN_LEVEL).toBe(-5);
    expect(ZOOM_MAX_LEVEL).toBe(5);
  });

  it('clampZoomLevel keeps a level within the shared bounds', () => {
    expect(clampZoomLevel(0)).toBe(0);
    expect(clampZoomLevel(99)).toBe(ZOOM_MAX_LEVEL);
    expect(clampZoomLevel(-99)).toBe(ZOOM_MIN_LEVEL);
    expect(clampZoomLevel(ZOOM_MAX_LEVEL)).toBe(ZOOM_MAX_LEVEL);
    expect(clampZoomLevel(ZOOM_MIN_LEVEL)).toBe(ZOOM_MIN_LEVEL);
  });

  it('stepZoomLevel at a bound is a no-op (FR-011)', () => {
    expect(stepZoomLevel(ZOOM_MAX_LEVEL, 1)).toBe(ZOOM_MAX_LEVEL);
    expect(stepZoomLevel(ZOOM_MIN_LEVEL, -1)).toBe(ZOOM_MIN_LEVEL);
  });

  it('stepZoomLevel steps by presses × the shared step, clamped', () => {
    expect(stepZoomLevel(0, 1)).toBe(ZOOM_STEP);
    expect(stepZoomLevel(0, -1)).toBe(-ZOOM_STEP);
    expect(stepZoomLevel(0, 2)).toBe(2 * ZOOM_STEP);
    expect(stepZoomLevel(4.5, 2)).toBe(ZOOM_MAX_LEVEL); // clamps
  });

  it('zoomFactor(0) === 1 and strictly increases with level', () => {
    expect(zoomFactor(0)).toBe(1);
    expect(zoomFactor(1)).toBeGreaterThan(zoomFactor(0));
    expect(zoomFactor(-1)).toBeLessThan(zoomFactor(0));
    // monotonic across the whole range
    for (let l = ZOOM_MIN_LEVEL; l < ZOOM_MAX_LEVEL; l += 0.5) {
      expect(zoomFactor(l + 0.5)).toBeGreaterThan(zoomFactor(l));
    }
  });
});
