import { describe, it, expect } from 'vitest';
import { bandFor, NOT_MEASURED, unavailable, type UsageThresholds } from '../../../src/resources/index.js';

const thresholds: UsageThresholds = { cpuWarning: 50, cpuCritical: 80, memoryWarning: 50, memoryCritical: 80 };
const machine = { logicalProcessors: 8, installedRamBytes: 1_000 };

describe('bandFor (055 FR-046)', () => {
  it('bands CPU on its share of the machine at the configured thresholds', () => {
    expect(bandFor('cpu', 49.9, thresholds, machine)).toBe('normal');
    expect(bandFor('cpu', 50, thresholds, machine)).toBe('warning');
    expect(bandFor('cpu', 80, thresholds, machine)).toBe('critical');
  });

  it('bands memory on its share of installed RAM, not on bytes', () => {
    expect(bandFor('memory', 499, thresholds, machine)).toBe('normal');
    expect(bandFor('memory', 500, thresholds, machine)).toBe('warning');
    expect(bandFor('memory', 800, thresholds, machine)).toBe('critical');
  });

  it('follows changed thresholds', () => {
    const strict = { ...thresholds, cpuWarning: 10, cpuCritical: 20 };
    expect(bandFor('cpu', 15, strict, machine)).toBe('warning');
  });

  it('bands nothing that is not CPU or memory, and nothing that has no number', () => {
    expect(bandFor('gpu', 99, thresholds, machine)).toBeUndefined();
    expect(bandFor('ioRead', 1e9, thresholds, machine)).toBeUndefined();
    expect(bandFor('cpu', NOT_MEASURED, thresholds, machine)).toBeUndefined();
    expect(bandFor('memory', unavailable('denied'), thresholds, machine)).toBeUndefined();
  });
});
