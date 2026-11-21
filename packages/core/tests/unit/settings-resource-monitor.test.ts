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
    // 077 FR-001 — durations stored in ms: 2 s and 5 minutes.
    expect(DEFAULT_APP_SETTINGS.resourceMonitor).toEqual({
      captureIntervalMs: 2000,
      historyMs: 300_000,
      cpuWarningPercent: 50,
      cpuCriticalPercent: 80,
      memoryWarningPercent: 50,
      memoryCriticalPercent: 80,
      popoverDelayMs: 500,
    });
    expect(DEFAULT_APP_SETTINGS.confirmations.killProcesses).toBe('double');
  });

  it('parses what a user wrote and falls back per leaf', () => {
    const s = parseAppSettings({
      resourceMonitor: { captureIntervalMs: 10_000, historyMs: 'x', cpuWarningPercent: 40 },
      confirmations: { killProcesses: 'single' },
    });
    expect(s.resourceMonitor.captureIntervalMs).toBe(10_000);
    expect(s.resourceMonitor.historyMs).toBe(300_000);
    expect(s.resourceMonitor.cpuWarningPercent).toBe(40);
    expect(s.confirmations.killProcesses).toBe('single');
  });

  it('never shares the defaults object with a parsed result', () => {
    const s = parseAppSettings(undefined);
    s.resourceMonitor.historyMs = 1_800_000;
    expect(DEFAULT_APP_SETTINGS.resourceMonitor.historyMs).toBe(300_000);
  });

  it('opens files throng cannot in the OS by default, as a toggle (067 FR-116)', () => {
    expect(DEFAULT_APP_SETTINGS.explorer.openUnsupportedInOs).toBe(true);
    expect(parseAppSettings({ explorer: { openUnsupportedInOs: false } }).explorer.openUnsupportedInOs).toBe(false);
    expect(descriptor('explorer.openUnsupportedInOs')).toMatchObject({ group: 'File Explorer', control: 'toggle' });
  });

  // 077 R6 — a hover dwell: 0–1,500 ms in 25 ms steps on the slider, up to 10 s typed.
  it('offers the popover delay from 0 to 1,500 ms, and carries a stored value through', () => {
    expect(descriptor('resourceMonitor.popoverDelayMs')).toMatchObject({
      group: 'Resource Monitor',
      control: 'slider',
      min: 0,
      max: 1500,
      step: 25,
      hardMax: 10_000,
    });
    expect(parseAppSettings({ resourceMonitor: { popoverDelayMs: 1200 } }).resourceMonitor.popoverDelayMs).toBe(1200);
    expect(parseAppSettings({ resourceMonitor: { popoverDelayMs: 'x' } }).resourceMonitor.popoverDelayMs).toBe(500);
  });

  // 077 FR-001 — the two durations are stored in ms and step by one display unit (1 s, 1 minute).
  it.each([
    ['resourceMonitor.captureIntervalMs', 2000, 60_000, 1000],
    ['resourceMonitor.historyMs', 60_000, 1_800_000, 60_000],
    ['resourceMonitor.cpuWarningPercent', 1, 100, 1],
    ['resourceMonitor.cpuCriticalPercent', 1, 100, 1],
    ['resourceMonitor.memoryWarningPercent', 1, 100, 1],
    ['resourceMonitor.memoryCriticalPercent', 1, 100, 1],
  ])('%s is a whole-unit slider from %i to %i in steps of %i in the Resource Monitor group', (key, min, max, step) => {
    const d = descriptor(key);
    expect(d).toMatchObject({ group: 'Resource Monitor', control: 'slider', min, max, step });
  });

  it('shows the interval in seconds and the history in minutes (077 FR-001)', () => {
    expect(descriptor('resourceMonitor.captureIntervalMs')).toMatchObject({ label: 'Capture interval', storedUnit: 'ms', display: 's' });
    expect(descriptor('resourceMonitor.historyMs')).toMatchObject({ label: 'History window', storedUnit: 'ms', display: 'min' });
  });

  it('clamps a hand-edited value outside its range to the bound (FR-033a)', () => {
    const { value } = applyDeclaredBounds(
      { resourceMonitor: { historyMs: 5_400_000, captureIntervalMs: 0 } },
      SETTINGS_METADATA,
      DEFAULT_APP_SETTINGS,
    );
    const s = parseAppSettings(value);
    expect(s.resourceMonitor.historyMs).toBe(1_800_000);
    expect(s.resourceMonitor.captureIntervalMs).toBe(2000);
  });

  it('labels the confirmation "Kill processes" in the Resource Monitor group (FR-063b, 077 FR-022)', () => {
    expect(descriptor('confirmations.killProcesses')).toMatchObject({
      label: 'Kill processes',
      group: 'Resource Monitor',
      control: 'select',
    });
  });

  it("notes beside the interval when the window raised it, and only then (R11)", () => {
    const note = descriptor('resourceMonitor.captureIntervalMs')?.note;
    expect(note).toBeTypeOf('function');
    const raised = parseAppSettings({ resourceMonitor: { captureIntervalMs: 2000, historyMs: 720_000 } });
    expect(note!(raised)).toBe('Raised to 15 s: the minimum for a 12-minute history');
    expect(note!(parseAppSettings(undefined))).toBeUndefined();
  });
});
