import { describe, it, expect } from 'vitest';
import { clampAdjacent } from '../../src/renderer/workspace/resize-math.js';

const MIN = 0.1;

describe('clampAdjacent (split min-size, FR-011/038)', () => {
  it('moves size between neighbours, preserving their sum', () => {
    const next = clampAdjacent([0.5, 0.5], 0, 0.2, MIN);
    expect(next[0]).toBeCloseTo(0.7);
    expect(next[1]).toBeCloseTo(0.3);
    expect(next[0] + next[1]).toBeCloseTo(1);
  });

  it('clamps the dragged cell to the minimum (cannot collapse a neighbour)', () => {
    const next = clampAdjacent([0.5, 0.5], 0, 1, MIN); // huge delta
    expect(next[0]).toBeCloseTo(1 - MIN);
    expect(next[1]).toBeCloseTo(MIN);
  });

  it('clamps the other direction to the minimum too', () => {
    const next = clampAdjacent([0.5, 0.5], 0, -1, MIN);
    expect(next[0]).toBeCloseTo(MIN);
    expect(next[1]).toBeCloseTo(1 - MIN);
  });

  it('only affects the two adjacent cells in a larger split', () => {
    const next = clampAdjacent([0.3, 0.3, 0.4], 0, 0.1, MIN);
    expect(next[2]).toBe(0.4);
    expect(next[0] + next[1]).toBeCloseTo(0.6);
  });
});
