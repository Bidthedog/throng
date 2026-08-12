/**
 * 031 (T062 / T088 / T106) — the three `Tabs` settings.
 *
 * `tabs.smoothScrollMs` (FR-030), `tabs.closeArmingDelayMs` (FR-044h) and `tabs.maxNameLength`
 * (FR-034) are the first settings added AFTER the declared-bounds guard, so they are also the
 * first whose ranges are enforced purely because they were DECLARED — no hand-written clamp
 * anywhere (FR-041, and #227's whole point).
 *
 * The steps are not free choices, and that is what the reachability assertion below is for.
 * `slider-descriptors.test.ts` requires a step of at least 1% of the range, which rules out a step
 * of 1 on a 118-wide range (0.85%). Having been forced up to 2, the step must still LAND on the
 * shipped default — a slider whose default sits between two stops cannot be dragged back to it.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { parseSettingsGuarded } from '../../src/config/settings-read.js';
import { getAtPath } from '../../src/config/metadata.js';

const byKey = new Map(SETTINGS_METADATA.map((d) => [d.key, d]));

const EXPECTED = [
  { key: 'tabs.smoothScrollMs', min: 0, max: 3000, step: 50, value: 300 },
  { key: 'tabs.closeArmingDelayMs', min: 0, max: 2000, step: 50, value: 300 },
  { key: 'tabs.maxNameLength', min: 10, max: 128, step: 2, value: 64 },
] as const;

describe('the Tabs settings group (FR-030, FR-034, FR-044h, FR-047)', () => {
  it('ships all three defaults', () => {
    expect(DEFAULT_APP_SETTINGS.tabs).toEqual({
      smoothScrollMs: 300,
      closeArmingDelayMs: 300,
      maxNameLength: 64,
    });
  });

  it('describes each one as a Tabs-group slider with the declared range and step', () => {
    for (const e of EXPECTED) {
      const d = byKey.get(e.key);
      expect(d, `no descriptor for ${e.key}`).toBeDefined();
      expect(d!.group, e.key).toBe('Tabs');
      expect(d!.control, e.key).toBe('slider');
      expect(d!.min, e.key).toBe(e.min);
      expect(d!.max, e.key).toBe(e.max);
      expect(d!.step, e.key).toBe(e.step);
      // The guard enforces the CONTROL's range for these three: no wider hand-set value is
      // legitimate, so neither declares a hard bound (contrast diagnostics.maxFileSizeKb).
      expect(d!.hardMin, e.key).toBeUndefined();
      expect(d!.hardMax, e.key).toBeUndefined();
    }
  });

  it('puts the shipped default on a step the slider can actually land on', () => {
    for (const e of EXPECTED) {
      const shipped = getAtPath(DEFAULT_APP_SETTINGS, e.key) as number;
      expect(shipped, e.key).toBe(e.value);
      expect((shipped - e.min) % e.step, `${e.key}: ${shipped} is between two stops`).toBe(0);
    }
  });
});

describe('the Tabs settings are bounded by their DECLARATION alone (FR-041)', () => {
  it('clamps a below-minimum value up to the declared minimum', () => {
    const { value, corrected } = parseSettingsGuarded({
      tabs: { smoothScrollMs: -1000, closeArmingDelayMs: -1, maxNameLength: 1 },
    });
    expect(value.tabs).toEqual({ smoothScrollMs: 0, closeArmingDelayMs: 0, maxNameLength: 10 });
    expect(corrected).toBe(true);
  });

  it('clamps an above-maximum value down to the declared maximum', () => {
    const { value, corrected } = parseSettingsGuarded({
      tabs: { smoothScrollMs: 99_999, closeArmingDelayMs: 99_999, maxNameLength: 99_999 },
    });
    expect(value.tabs).toEqual({ smoothScrollMs: 3000, closeArmingDelayMs: 2000, maxNameLength: 128 });
    expect(corrected).toBe(true);
  });

  it('leaves the shipped values alone and reports no correction', () => {
    // A COMPLETE document: an absent key is a substitution like any other, so a partial one is
    // legitimately "corrected" and would say nothing about the three settings under test.
    const { value, corrected } = parseSettingsGuarded(structuredClone(DEFAULT_APP_SETTINGS));
    expect(value.tabs).toEqual(DEFAULT_APP_SETTINGS.tabs);
    expect(corrected).toBe(false);
  });

  it('falls back to the shipped default for a value that is not a number at all', () => {
    const parsed = parseAppSettings({ tabs: { smoothScrollMs: 'fast', maxNameLength: null } });
    expect(parsed.tabs.smoothScrollMs).toBe(300);
    expect(parsed.tabs.maxNameLength).toBe(64);
  });
});
