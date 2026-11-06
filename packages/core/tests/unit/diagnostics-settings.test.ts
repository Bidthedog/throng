import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_RETENTION,
  SETTINGS_METADATA,
  buildShippedDefaults,
  parseAppSettings,
  parseSettingsGuarded,
} from '@throng/core';

/**
 * 066 FR-019 / FR-019a / FR-020 — retention is configured by active days and a folder cap, and the
 * keep-N-files setting it replaces (031 FR-015's `diagnostics.keepFiles`) is gone.
 */

const descriptor = (key: string) => SETTINGS_METADATA.find((d) => d.key === key);

describe('the retention settings', () => {
  it('declares diagnostics.keepDays: a slider, 1–30, default 3', () => {
    const d = descriptor('diagnostics.keepDays');
    expect(d).toMatchObject({ control: 'slider', min: 1, max: 30, group: 'Logging' });
    expect(DEFAULT_APP_SETTINGS.diagnostics.keepDays).toBe(3);
    expect(DEFAULT_APP_SETTINGS.diagnostics.keepDays).toBe(DEFAULT_RETENTION.keepDays);
  });

  it('declares diagnostics.maxTotalMb: a slider, 50–2000 in steps of 50, default 100, hardMax 65536', () => {
    const d = descriptor('diagnostics.maxTotalMb');
    expect(d).toMatchObject({ control: 'slider', min: 50, max: 2000, step: 50, hardMax: 65_536, group: 'Logging' });
    expect(DEFAULT_APP_SETTINGS.diagnostics.maxTotalMb).toBe(100);
    expect(DEFAULT_APP_SETTINGS.diagnostics.maxTotalMb * 1024 * 1024).toBe(DEFAULT_RETENTION.maxTotalBytes);
  });

  it('ships both defaults', () => {
    const shipped = buildShippedDefaults().settings.diagnostics;
    expect(shipped).toMatchObject({ keepDays: 3, maxTotalMb: 100 });
  });

  it('no longer has diagnostics.keepFiles (superseded by 066 FR-020)', () => {
    expect(descriptor('diagnostics.keepFiles')).toBeUndefined();
    expect('keepFiles' in DEFAULT_APP_SETTINGS.diagnostics).toBe(false);
  });

  it('loads a settings file that still carries keepFiles, ignoring it', () => {
    const doc = { version: 1, diagnostics: { logLevel: 'debug', keepFiles: 7 } };
    const parsed = parseAppSettings(doc);
    expect(parsed.diagnostics.logLevel).toBe('debug');
    expect(parsed.diagnostics.keepDays).toBe(3);
    expect('keepFiles' in parsed.diagnostics).toBe(false);
    expect(() => parseSettingsGuarded({ ...structuredClone(DEFAULT_APP_SETTINGS), diagnostics: doc.diagnostics })).not.toThrow();
  });

  it('keeps a hand-set folder cap above the slider, up to its hard maximum', () => {
    const { value } = parseSettingsGuarded({
      ...structuredClone(DEFAULT_APP_SETTINGS),
      diagnostics: { ...DEFAULT_APP_SETTINGS.diagnostics, maxTotalMb: 40_000, keepDays: 99 },
    });
    expect(value.diagnostics.maxTotalMb).toBe(40_000);
    expect(value.diagnostics.keepDays).toBe(30);
  });
});
