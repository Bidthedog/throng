/**
 * The geometry behind a row's sparkline (055 FR-060): pure points, so the canvas drawing is just a
 * polyline through them. What is DRAWN is proved by the breakdown component test.
 */
import { describe, expect, it } from 'vitest';
import { sparklinePoints } from '../../../src/renderer/resources/sparkline.js';

describe('sparklinePoints', () => {
  it('draws nothing until there are two points, because one point is not a trend', () => {
    expect(sparklinePoints([], 100, 20)).toBeNull();
    expect(sparklinePoints([5], 100, 20)).toBeNull();
  });

  it('spreads the points across the width, the lowest on the floor and the highest at the top', () => {
    const pts = sparklinePoints([0, 5, 10], 100, 20)!;
    expect(pts.map((p) => p.x)).toEqual([0, 50, 100]);
    expect(pts[0]!.y).toBe(19);
    expect(pts[2]!.y).toBe(1);
  });

  it('puts a flat series through the middle, not along the floor where it would read as zero', () => {
    expect(sparklinePoints([3, 3, 3], 100, 20)!.map((p) => p.y)).toEqual([10, 10, 10]);
  });

  describe('from zero (a graph with a Y scale, FR-120)', () => {
    it('puts zero on the floor and the largest value at the top, so the scale\'s two labels are the line\'s two ends', () => {
      const pts = sparklinePoints([0, 5, 10], 100, 20, true)!;
      expect(pts.map((p) => p.y)).toEqual([19, 10, 1]);
    });

    it('does not float the lowest value to the floor: 8 and 10 stay near the top', () => {
      const pts = sparklinePoints([8, 10], 100, 20, true)!;
      expect(pts[0]!.y).toBeCloseTo(19 - 0.8 * 18, 6);
      expect(pts[1]!.y).toBe(1);
    });

    it('puts a flat non-zero series at the top (it IS the maximum) and a flat zero series on the floor', () => {
      expect(sparklinePoints([3, 3], 100, 20, true)!.map((p) => p.y)).toEqual([1, 1]);
      expect(sparklinePoints([0, 0], 100, 20, true)!.map((p) => p.y)).toEqual([19, 19]);
    });
  });
});
