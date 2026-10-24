import { describe, it, expect } from 'vitest';
import { isIdle, NOT_MEASURED, ZERO_METRICS, type Metrics } from '../../../src/resources/index.js';

const thresholds = { cpuWarning: 50, cpuCritical: 80, memoryWarning: 50, memoryCritical: 80 };
const machine = { logicalProcessors: 4, installedRamBytes: 1_000 };
const s = (over: Partial<Metrics> = {}): Metrics => ({ ...ZERO_METRICS, memory: 10, ...over });

describe('isIdle (055 FR-061a)', () => {
  it('is idle when own CPU stays under 0.1% and own I/O at zero over the last 3 samples', () => {
    expect(isIdle([s({ cpu: 5 }), s({ cpu: 0.05 }), s(), s({ cpu: 0.09 })], thresholds, machine)).toBe(true);
  });

  it('is not idle when any of the last 3 samples shows CPU or I/O', () => {
    expect(isIdle([s(), s({ cpu: 0.1 }), s()], thresholds, machine)).toBe(false);
    expect(isIdle([s(), s(), s({ ioWrite: 1 })], thresholds, machine)).toBe(false);
    expect(isIdle([s({ ioRead: 4 }), s(), s()], thresholds, machine)).toBe(false);
  });

  it('judges on fewer samples while fewer exist, and a first sighting with no rate yet counts as quiet', () => {
    expect(isIdle([s({ cpu: NOT_MEASURED, ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED })], thresholds, machine)).toBe(true);
    expect(isIdle([s({ cpu: 3 })], thresholds, machine)).toBe(false);
  });

  it('never calls a process idle while its memory is at or above the memory warning threshold', () => {
    expect(isIdle([s(), s(), s({ memory: 500 })], thresholds, machine)).toBe(false);
  });

  it('is not idle while it moves network traffic, however quiet its CPU and disk (FR-113, review #6)', () => {
    expect(isIdle([s({ network: 2_048 }), s(), s()], thresholds, machine)).toBe(false);
  });

  it('is not idle with no samples at all — there is nothing to judge', () => {
    expect(isIdle([], thresholds, machine)).toBe(false);
  });
});
