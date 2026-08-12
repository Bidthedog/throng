/**
 * 031 (T062 / T088 / T106, then US6) — the `Tabs` settings group.
 *
 * `tabs.smoothScrollMs` (FR-030), `tabs.closeArmingDelayMs` (FR-044h) and `tabs.maxNameLength`
 * (FR-034) are the first settings added AFTER the declared-bounds guard, so they are also the
 * first whose ranges are enforced purely because they were DECLARED — no hand-written clamp
 * anywhere (FR-041, and #227's whole point). US6 adds three more on the same terms:
 * `tabs.maxWidth` (FR-050), `tabs.newTabPosition` (FR-053a) and `tabs.chevronRepeatDelayMs`
 * (FR-054a).
 *
 * The steps are not free choices, and that is what the reachability assertion below is for.
 * `slider-descriptors.test.ts` requires a step of at least 1% of the range, which rules out a step
 * of 1 on a 118-wide range (0.85%). Having been forced up to 2, the step must still LAND on the
 * shipped default — a slider whose default sits between two stops cannot be dragged back to it.
 * That second half is asserted HERE and nowhere else: the shared slider guard checks the step's
 * size and says nothing about whether the default is on one.
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
  // US6. `maxWidth` shares the name limit's 10–128 range ON PURPOSE (FR-050): both count
  // CHARACTERS, so a user can compare "the longest name" against "the widest tab" without
  // converting between units — and it inherits the same forced step of 2, because 1 across 118 is
  // 0.85% and the aimable-slider rule rejects it.
  { key: 'tabs.maxWidth', min: 10, max: 128, step: 2, value: 32 },
  { key: 'tabs.chevronRepeatDelayMs', min: 100, max: 3000, step: 50, value: 500 },
] as const;

describe('the Tabs settings group (FR-030, FR-034, FR-044h, FR-047, FR-050, FR-054a)', () => {
  it('ships every default', () => {
    expect(DEFAULT_APP_SETTINGS.tabs).toEqual({
      smoothScrollMs: 300,
      closeArmingDelayMs: 300,
      maxNameLength: 64,
      maxWidth: 32,
      newTabPosition: 'afterActive',
      chevronRepeatDelayMs: 500,
    });
  });

  it('describes each numeric one as a Tabs-group slider with the declared range and step', () => {
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
    // NOT covered by `slider-descriptors.test.ts`, which checks a step's SIZE and never asks
    // whether the shipped value sits on one. A default between two stops is a setting the user can
    // leave but not return to.
    for (const e of EXPECTED) {
      const shipped = getAtPath(DEFAULT_APP_SETTINGS, e.key) as number;
      expect(shipped, e.key).toBe(e.value);
      expect((shipped - e.min) % e.step, `${e.key}: ${shipped} is between two stops`).toBe(0);
    }
  });

  it('describes the new-tab position as a Tabs-group select over its two behaviours (FR-053a)', () => {
    const d = byKey.get('tabs.newTabPosition');
    expect(d, 'no descriptor for tabs.newTabPosition').toBeDefined();
    expect(d!.group).toBe('Tabs');
    expect(d!.control).toBe('select');
    expect(d!.allowedValues).toEqual(['afterActive', 'end']);
    // A select carries no numeric range, and must not: `slider-descriptors.test.ts` reads
    // min+max as "this wanted a slider" and would fail the build for declaring both here.
    expect(d!.min).toBeUndefined();
    expect(d!.max).toBeUndefined();
  });
});

describe('the Tabs settings are bounded by their DECLARATION alone (FR-041)', () => {
  it('clamps a below-minimum value up to the declared minimum', () => {
    const { value, corrected } = parseSettingsGuarded({
      tabs: {
        smoothScrollMs: -1000,
        closeArmingDelayMs: -1,
        maxNameLength: 1,
        maxWidth: 0,
        chevronRepeatDelayMs: 5,
      },
    });
    expect(value.tabs).toEqual({
      smoothScrollMs: 0,
      closeArmingDelayMs: 0,
      maxNameLength: 10,
      maxWidth: 10,
      newTabPosition: 'afterActive',
      chevronRepeatDelayMs: 100,
    });
    expect(corrected).toBe(true);
  });

  it('clamps an above-maximum value down to the declared maximum', () => {
    const { value, corrected } = parseSettingsGuarded({
      tabs: {
        smoothScrollMs: 99_999,
        closeArmingDelayMs: 99_999,
        maxNameLength: 99_999,
        maxWidth: 99_999,
        chevronRepeatDelayMs: 99_999,
      },
    });
    expect(value.tabs).toEqual({
      smoothScrollMs: 3000,
      closeArmingDelayMs: 2000,
      maxNameLength: 128,
      maxWidth: 128,
      newTabPosition: 'afterActive',
      chevronRepeatDelayMs: 3000,
    });
    expect(corrected).toBe(true);
  });

  it('substitutes the default for a new-tab position outside the declared set', () => {
    const { value, corrected } = parseSettingsGuarded({ tabs: { newTabPosition: 'somewhere' } });
    expect(value.tabs.newTabPosition).toBe('afterActive');
    expect(corrected).toBe(true);
  });

  it('keeps a new-tab position the set does allow', () => {
    const raw = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
    (raw.tabs as Record<string, unknown>).newTabPosition = 'end';
    const { value, corrected } = parseSettingsGuarded(raw);
    expect(value.tabs.newTabPosition).toBe('end');
    expect(corrected).toBe(false);
  });

  it('leaves the shipped values alone and reports no correction', () => {
    // A COMPLETE document: an absent key is a substitution like any other, so a partial one is
    // legitimately "corrected" and would say nothing about the three settings under test.
    const { value, corrected } = parseSettingsGuarded(structuredClone(DEFAULT_APP_SETTINGS));
    expect(value.tabs).toEqual(DEFAULT_APP_SETTINGS.tabs);
    expect(corrected).toBe(false);
  });

  it('falls back to the shipped default for a value that is not a number at all', () => {
    const parsed = parseAppSettings({
      tabs: {
        smoothScrollMs: 'fast',
        maxNameLength: null,
        maxWidth: 'wide',
        chevronRepeatDelayMs: [],
        newTabPosition: 7,
      },
    });
    expect(parsed.tabs.smoothScrollMs).toBe(300);
    expect(parsed.tabs.maxNameLength).toBe(64);
    expect(parsed.tabs.maxWidth).toBe(32);
    expect(parsed.tabs.chevronRepeatDelayMs).toBe(500);
    expect(parsed.tabs.newTabPosition).toBe('afterActive');
  });
});
