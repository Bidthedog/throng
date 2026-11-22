/**
 * 077 FR-005 — a numeric setting's row shows its value in a display unit (0.3 s, 500 ms, 400 px, 5 MB) and the exact
 * stored value in the box beside it. A description that names a unit as well can only contradict one of the two: the
 * Auto-save delay read "Debounce (ms)" over a value shown as 0.3 s (walk-through MT-80, 2026-11-21). So a numeric
 * setting's description says what the number does and leaves the unit to the control.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

const UNIT_WORDING = /\((?:ms|s|px|MB|bytes)\)|\bin (?:milliseconds|seconds|pixels|bytes)\b|,\s*in (?:milliseconds|seconds|pixels)\b/i;

describe('numeric setting descriptions leave the unit to the control (077 FR-005)', () => {
  const numeric = SETTINGS_METADATA.filter((d) => d.storedUnit !== undefined);

  it('covers the numeric settings', () => {
    expect(numeric.length).toBeGreaterThan(20);
  });

  it.each(numeric.map((d) => [d.key, d.description ?? ''] as const))('%s names no unit', (_key, description) => {
    expect(description).not.toMatch(UNIT_WORDING);
  });
});
