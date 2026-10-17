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
});
