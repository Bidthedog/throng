import { describe, expect, it } from 'vitest';

import { clampToViewport } from '../../src/renderer/common/clamp-to-viewport.js';

/**
 * US11 / FR-036 — the shared viewport positioner. Flips + clamps on BOTH axes. The colour picker
 * and the context menu both consume it, so this is the regression guard for both.
 */
const VIEWPORT = { width: 1000, height: 800 };

describe('clampToViewport', () => {
  it('opens at the anchor left/bottom when there is room (no flip)', () => {
    const anchor = { left: 100, top: 100, right: 140, bottom: 120 };
    expect(clampToViewport(anchor, { width: 200, height: 150 }, VIEWPORT)).toEqual({
      left: 100,
      top: 120,
    });
  });

  it('flips horizontally (right-aligns) near the RIGHT edge', () => {
    // anchor.left (950) + width (200) = 1150 > 1000 → flip to anchor.right - width.
    const anchor = { left: 950, top: 100, right: 980, bottom: 120 };
    const { left } = clampToViewport(anchor, { width: 200, height: 150 }, VIEWPORT);
    // right-aligned to 980 - 200 = 780, still on-screen.
    expect(left).toBe(780);
    expect(left + 200).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('flips vertically (opens above) near the BOTTOM edge', () => {
    // anchor.bottom (780) + height (150) = 930 > 800 → flip to anchor.top - height.
    const anchor = { left: 100, top: 760, right: 140, bottom: 780 };
    const { top } = clampToViewport(anchor, { width: 200, height: 150 }, VIEWPORT);
    expect(top).toBe(760 - 150); // 610
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('flips on BOTH axes at once (bottom-right corner)', () => {
    const anchor = { left: 960, top: 770, right: 990, bottom: 790 };
    const { left, top } = clampToViewport(anchor, { width: 200, height: 150 }, VIEWPORT);
    expect(left).toBe(790); // 990 - 200 (right-aligned to anchor)
    expect(top).toBe(620); // 770 - 150 (opens above, from anchor.top)
    expect(left + 200).toBeLessThanOrEqual(VIEWPORT.width);
    expect(top + 150).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('clamps to 0 when even the flipped position would go off the top/left', () => {
    // A surface taller/wider than the room: clamp to the viewport origin.
    const anchor = { left: 10, top: 10, right: 10, bottom: 10 };
    expect(clampToViewport(anchor, { width: 200, height: 900 }, VIEWPORT)).toEqual({
      left: 10,
      top: 0,
    });
  });

  it('behaves as a point anchor for the context menu (left === right, top === bottom)', () => {
    // The context-menu call site: a cursor point. Near the right/bottom it flips by subtracting size.
    const point = { left: 950, top: 770, right: 950, bottom: 770 };
    const { left, top } = clampToViewport(point, { width: 200, height: 150 }, VIEWPORT);
    expect(left).toBe(750); // 950 - 200
    expect(top).toBe(620); // 770 - 150
  });
});
