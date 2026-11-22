import { describe, it, expect } from 'vitest';
import {
  allowedIntervals,
  historyLength,
  minimumIntervalFor,
  CAPTURE_INTERVAL_MS,
  resolveResourceMonitorSettings,
  type ResourceMonitorRaw,
} from '../../../src/resources/index.js';

// 077 FR-001 — the raw leaves are stored in ms; the resolved settings still speak seconds and minutes.
const raw = (over: Partial<ResourceMonitorRaw> = {}): ResourceMonitorRaw => ({
  captureIntervalMs: 2000,
  historyMs: 300_000,
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
    const r = resolveResourceMonitorSettings(raw({ captureIntervalMs: 10_000, historyMs: 300_000 }));
    expect(r.intervalSeconds).toBe(10);
    expect(r.intervalRaised).toBe(false);
  });

  it("raises an interval below the window's minimum, and says so", () => {
    const r = resolveResourceMonitorSettings(raw({ captureIntervalMs: 2000, historyMs: 720_000 }));
    expect(r.intervalSeconds).toBe(15);
    expect(r.historyMinutes).toBe(12);
    expect(r.intervalRaised).toBe(true);
  });

  // 077 FR-016 — no second cap: the bounds guard holds the stored interval to its descriptor's 2–60 s, so the resolver
  // uses what it is given (it still raises it to the window's minimum, a rule between two settings).
  it('uses the stored interval as it is, without a cap of its own', () => {
    expect(resolveResourceMonitorSettings(raw({ captureIntervalMs: 90_000 })).intervalSeconds).toBe(90);
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
        const r = resolveResourceMonitorSettings(raw({ captureIntervalMs: interval * 1000, historyMs: minutes * 60_000 }));
        expect(historyLength(r)).toBeLessThanOrEqual(150);
      }
    }
  });

  it('sizes the history as ceil(minutes × 60 / interval)', () => {
    expect(historyLength({ historyMinutes: 5, intervalSeconds: 2 })).toBe(150);
    expect(historyLength({ historyMinutes: 1, intervalSeconds: 7 })).toBe(9);
  });
});

describe('allowedIntervals (055 FR-004a; 077 FR-017)', () => {
  const seconds = (from: number): number[] => Array.from({ length: 60 - from + 1 }, (_, i) => from + i);

  it("offers every stop the Preferences slider has, from the window's minimum to 60 s", () => {
    expect(allowedIntervals(5)).toEqual(seconds(2));
    expect(allowedIntervals(12)).toEqual(seconds(15));
    expect(allowedIntervals(30)).toEqual(seconds(30));
  });

  it("matches the capture-interval descriptor's slider", () => {
    expect(CAPTURE_INTERVAL_MS).toEqual({ min: 2000, max: 60_000, step: 1000 });
  });
});
