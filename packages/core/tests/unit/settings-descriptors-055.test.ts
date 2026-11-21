import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 055 T016 — every setting this spec adds has a descriptor (Principle X): the seven
 * `resourceMonitor.*` leaves and `confirmations.killProcesses`.
 *
 * This file used to be `settings-inertness-055.test.ts` and also checked, by matching source text,
 * that the resolver reads every leaf, that UI main and the renderer both call it, and that the kill
 * dialog reads `confirmations.killProcesses`. That reader guarantee now belongs to
 * `no-inert-settings.test.ts` (spec 071, FR-014), which proves it for every descriptor through the
 * type checker; only the descriptor check stays here.
 */

const LEAVES = [
  'captureIntervalMs',
  'historyMs',
  'cpuWarningPercent',
  'cpuCriticalPercent',
  'memoryWarningPercent',
  'memoryCriticalPercent',
  'popoverDelayMs',
] as const;

describe('055 describes every setting it adds (T016)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('describes every new leaf', () => {
    for (const leaf of LEAVES) expect(declared).toContain(`resourceMonitor.${leaf}`);
    expect(declared).toContain('confirmations.killProcesses');
  });
});
