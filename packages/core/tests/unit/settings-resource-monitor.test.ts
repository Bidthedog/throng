import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { applyDeclaredBounds } from '../../src/config/bounds-guard.js';

/**
 * 055 T016 — the resource monitor's six settings and its kill confirmation (research R11).
 * Registry-wide guards (descriptor completeness, slider aim, clamping) discover these leaves on their
 * own; this file pins what is particular to them.
 */

const descriptor = (key: string) => SETTINGS_METADATA.find((d) => d.key === key);

describe('resource monitor settings (055 FR-004, FR-033a, FR-046, FR-063)', () => {
  it('ships the clarified defaults', () => {
    expect(DEFAULT_APP_SETTINGS.resourceMonitor).toEqual({
      captureIntervalSeconds: 2,
      historyMinutes: 5,
      cpuWarningPercent: 50,
      cpuCriticalPercent: 80,
      memoryWarningPercent: 50,
      memoryCriticalPercent: 80,
    });
    expect(DEFAULT_APP_SETTINGS.confirmations.killProcesses).toBe('double');
  });

  it('parses what a user wrote and falls back per leaf', () => {
    const s = parseAppSettings({
      resourceMonitor: { captureIntervalSeconds: 10, historyMinutes: 'x', cpuWarningPercent: 40 },
      confirmations: { killProcesses: 'single' },
    });
    expect(s.resourceMonitor.captureIntervalSeconds).toBe(10);
    expect(s.resourceMonitor.historyMinutes).toBe(5);
    expect(s.resourceMonitor.cpuWarningPercent).toBe(40);
    expect(s.confirmations.killProcesses).toBe('single');
  });

  it('never shares the defaults object with a parsed result', () => {
    const s = parseAppSettings(undefined);
    s.resourceMonitor.historyMinutes = 30;
    expect(DEFAULT_APP_SETTINGS.resourceMonitor.historyMinutes).toBe(5);
  });

  it.each([
    ['resourceMonitor.captureIntervalSeconds', 2, 60],
    ['resourceMonitor.historyMinutes', 1, 30],
    ['resourceMonitor.cpuWarningPercent', 1, 100],
    ['resourceMonitor.cpuCriticalPercent', 1, 100],
    ['resourceMonitor.memoryWarningPercent', 1, 100],
    ['resourceMonitor.memoryCriticalPercent', 1, 100],
  ])('%s is a whole-number slider from %i to %i in the Resource Monitor group', (key, min, max) => {
    const d = descriptor(key);
    expect(d).toMatchObject({ group: 'Resource Monitor', control: 'slider', min, max, step: 1 });
  });

  it('clamps a hand-edited value outside its range to the bound (FR-033a)', () => {
    const { value } = applyDeclaredBounds(
      { resourceMonitor: { historyMinutes: 90, captureIntervalSeconds: 0 } },
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    const s = parseAppSettings(value);
    expect(s.resourceMonitor.historyMinutes).toBe(30);
    expect(s.resourceMonitor.captureIntervalSeconds).toBe(2);
  });

  it('labels the confirmation "Kill processes" among the other confirmations (FR-063)', () => {
    expect(descriptor('confirmations.killProcesses')).toMatchObject({
      label: 'Kill processes',
      group: 'Confirmations',
      control: 'select',
    });
  });

  it("notes beside the interval when the window raised it, and only then (R11)", () => {
    const note = descriptor('resourceMonitor.captureIntervalSeconds')?.note;
    expect(note).toBeTypeOf('function');
    const raised = parseAppSettings({ resourceMonitor: { captureIntervalSeconds: 2, historyMinutes: 12 } });
    expect(note!(raised)).toBe('Raised to 15 s: the minimum for a 12-minute history');
    expect(note!(parseAppSettings(undefined))).toBeUndefined();
  });
});
