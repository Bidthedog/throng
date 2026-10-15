import { describe, it, expect } from 'vitest';
import {
  allowedIntervals,
  historyLength,
  minimumIntervalFor,
  resolveResourceMonitorSettings,
  type ResourceMonitorRaw,
} from '../../../src/resources/index.js';

const raw = (over: Partial<ResourceMonitorRaw> = {}): ResourceMonitorRaw => ({
  captureIntervalSeconds: 2,
  historyMinutes: 5,
  cpuWarningPercent: 50,
  cpuCriticalPercent: 80,
  memoryWarningPercent: 50,
  memoryCriticalPercent: 80,
  ...over,
});

describe('minimumIntervalFor (055 FR-004b band table)', () => {
  it.each([
    [1, 2],
    [5, 2],
    [6, 5],
    [10, 5],
    [11, 15],
    [20, 15],
    [21, 30],
    [30, 30],
  ])('a %i-minute window needs at least %i s', (minutes, seconds) => {
    expect(minimumIntervalFor(minutes)).toBe(seconds);
  });
});

describe('resolveResourceMonitorSettings (055 FR-004, FR-004b, FR-046)', () => {
  it('keeps an interval the window allows, unflagged', () => {
    const r = resolveResourceMonitorSettings(raw({ captureIntervalSeconds: 10, historyMinutes: 5 }));
    expect(r.intervalSeconds).toBe(10);
    expect(r.intervalRaised).toBe(false);
  });

  it("raises an interval below the window's minimum, and says so", () => {
    const r = resolveResourceMonitorSettings(raw({ captureIntervalSeconds: 2, historyMinutes: 12 }));
    expect(r.intervalSeconds).toBe(15);
    expect(r.intervalRaised).toBe(true);
  });

  it('caps the interval at 60 s', () => {
    expect(resolveResourceMonitorSettings(raw({ captureIntervalSeconds: 600 })).intervalSeconds).toBe(60);
  });

  it('lowers a warning at or above its critical to one below it', () => {
    const r = resolveResourceMonitorSettings(raw({ cpuWarningPercent: 90, cpuCriticalPercent: 80, memoryWarningPercent: 70, memoryCriticalPercent: 70 }));
    expect(r.thresholds).toEqual({ cpuWarning: 79, cpuCritical: 80, memoryWarning: 69, memoryCritical: 70 });
  });

  it('never lowers a warning below 1%, even when its critical is 1%', () => {
    const r = resolveResourceMonitorSettings(raw({ cpuWarningPercent: 5, cpuCriticalPercent: 1, memoryWarningPercent: 1, memoryCriticalPercent: 1 }));
    expect(r.thresholds.cpuWarning).toBe(1);
    expect(r.thresholds.memoryWarning).toBe(1);
  });

  it('never keeps more than 150 points per node, at any resolved pairing', () => {
    for (let minutes = 1; minutes <= 30; minutes++) {
      for (const interval of [2, 3, 5, 7, 15, 30, 60]) {
        const r = resolveResourceMonitorSettings(raw({ captureIntervalSeconds: interval, historyMinutes: minutes }));
        expect(historyLength(r)).toBeLessThanOrEqual(150);
      }
    }
  });

  it('sizes the history as ceil(minutes × 60 / interval)', () => {
    expect(historyLength({ historyMinutes: 5, intervalSeconds: 2 })).toBe(150);
    expect(historyLength({ historyMinutes: 1, intervalSeconds: 7 })).toBe(9);
  });
});

describe('allowedIntervals (055 FR-004a)', () => {
  it("offers only intervals at or above the window's minimum, up to 60 s", () => {
    expect(allowedIntervals(5)).toEqual([2, 5, 10, 15, 30, 60]);
    expect(allowedIntervals(12)).toEqual([15, 30, 60]);
    expect(allowedIntervals(30)).toEqual([30, 60]);
  });
});
