/**
 * 077 FR-002 (SC-006; contracts/settings-upgrade-v37.md) — a settings file from before 077 keeps every value it
 * held, now stored in ms or bytes under the key's new name, and running the upgrade again changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { applySettingsUpgrade, buildShippedDefaults, SHIPPED_DEFAULTS_VERSION } from '../../src/index.js';

const shipped = buildShippedDefaults();

describe('settings upgrade, shipped-defaults version 37', () => {
  it('is version 37 or later', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBeGreaterThanOrEqual(37);
  });

  it('moves each released key to its new name, converted exactly, and drops the old one', () => {
    const before = {
      terminals: { attention: { enabled: true, quietSeconds: 30 } },
      resourceMonitor: { captureIntervalSeconds: 5, historyMinutes: 10, cpuWarningPercent: 40 },
      diagnostics: { logLevel: 'info', maxFileSizeKb: 2048, keepDays: 7, maxTotalMb: 300 },
    };
    expect(applySettingsUpgrade(before, shipped)).toEqual({
      terminals: { attention: { enabled: true, quietMs: 30_000 } },
      resourceMonitor: { captureIntervalMs: 5000, historyMs: 600_000, cpuWarningPercent: 40 },
      diagnostics: { logLevel: 'info', maxFileBytes: 2_097_152, keepDays: 7, maxTotalBytes: 314_572_800 },
    });
  });

  it('keeps a new key already present and only drops the old one', () => {
    const before = { terminals: { attention: { quietSeconds: 30, quietMs: 45_500 } } };
    expect(applySettingsUpgrade(before, shipped)).toEqual({ terminals: { attention: { quietMs: 45_500 } } });
  });

  it('takes the shipped value for an old key that holds no number', () => {
    const before = { diagnostics: { maxTotalMb: 'lots' } };
    expect(applySettingsUpgrade(before, shipped)).toEqual({
      diagnostics: { maxTotalBytes: shipped.settings.diagnostics.maxTotalBytes },
    });
  });

  it('leaves a file with none of the old keys alone', () => {
    const before = { resourceMonitor: { captureIntervalMs: 3000 } };
    expect(applySettingsUpgrade(before, shipped)).toBe(before);
  });

  it('changes nothing on a second run', () => {
    const once = applySettingsUpgrade(
      { terminals: { attention: { quietSeconds: 20 } }, diagnostics: { maxFileSizeKb: 512 } },
      shipped,
    );
    expect(applySettingsUpgrade(once, shipped)).toBe(once);
  });
});
