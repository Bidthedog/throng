import { describe, expect, it } from 'vitest';
import { heatFor, type HeatMetric, type UsageThresholds } from '../../../src/resources/index.js';

/**
 * 055 FR-094 — a tile's colour says how much of the MACHINE its node takes: 1% of the CPU is low, 80% is
 * high. `heatFor` is that share placed on the scale the renderer colours: 0 at nothing, 0.5 at the
 * warning threshold, 1 at the critical threshold and beyond — the same thresholds FR-046's bands use, so a
 * tile and its figure never disagree.
 */
const T: UsageThresholds = { cpuWarning: 50, cpuCritical: 80, memoryWarning: 40, memoryCritical: 90 };
const MACHINE = { logicalProcessors: 8, installedRamBytes: 16 * 1024 ** 3 };
const heat = (metric: HeatMetric, value: number | { unavailable: string }, ioPeak = 0) =>
  heatFor(metric, value as never, T, MACHINE, ioPeak);

describe('heatFor (055 FR-094)', () => {
  it('puts 1% of the CPU low and 80% at the top', () => {
    expect(heat('cpu', 1)).toBeCloseTo(0.01, 5);
    expect(heat('cpu', 80)).toBe(1);
    expect(heat('cpu', 100)).toBe(1);
  });

  it('reaches the middle of the scale exactly at the warning threshold', () => {
    expect(heat('cpu', 50)).toBe(0.5);
    expect(heat('cpu', 65)).toBeCloseTo(0.75, 5);
  });

  it('measures memory as a share of installed RAM, against the memory thresholds', () => {
    expect(heat('memory', 0.4 * MACHINE.installedRamBytes)).toBe(0.5);
    expect(heat('memory', 0.9 * MACHINE.installedRamBytes)).toBe(1);
    expect(heat('memory', 0.2 * MACHINE.installedRamBytes)).toBeCloseTo(0.25, 5);
  });

  it('takes the CPU thresholds for the GPU', () => {
    expect(heat('gpu', 50)).toBe(0.5);
  });

  it('scales I/O against the highest rate seen, there being no machine total', () => {
    expect(heat('io', 500, 1000)).toBe(0.5);
    expect(heat('io', 1000, 1000)).toBe(1);
    expect(heat('io', 0, 1000)).toBe(0);
    expect(heat('io', 500, 0)).toBe(0);
  });

  it('has no heat for a figure that is not a number, or a machine it cannot measure against', () => {
    expect(heat('cpu', { unavailable: 'accessDenied' })).toBeUndefined();
    expect(heatFor('memory', 1024, T, { logicalProcessors: 8, installedRamBytes: 0 }, 0)).toBeUndefined();
  });

  it('never goes below zero', () => {
    expect(heat('cpu', -3)).toBe(0);
  });
});
