import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA, type AppSettings } from '../../../src/index.js';

const KEY = 'resourceMonitor.captureIntervalSeconds';
const descriptor = () => SETTINGS_METADATA.find((d) => d.key === KEY)!;
// `minFor` reads the history window alone; the rest of the settings are not its business.
const withHistory = (historyMinutes: number): AppSettings => ({ resourceMonitor: { historyMinutes } }) as unknown as AppSettings;

describe('the capture interval descriptor (055 FR-004)', () => {
  it('has a minimum that follows the history window, per the band table', () => {
    const d = descriptor();
    expect(d.minFor?.(withHistory(5))).toBe(2);
    expect(d.minFor?.(withHistory(10))).toBe(5);
    expect(d.minFor?.(withHistory(20))).toBe(15);
    expect(d.minFor?.(withHistory(30))).toBe(30);
  });

  it('never asks for a minimum above its own maximum', () => {
    const d = descriptor();
    for (let minutes = 1; minutes <= 30; minutes += 1) {
      expect(d.minFor!(withHistory(minutes))).toBeLessThanOrEqual(d.max!);
    }
  });
});
