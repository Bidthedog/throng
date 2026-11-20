/**
 * 077 — one place converts a numeric setting between its stored unit and the unit it is shown in, names its bounds,
 * and decides what a typed value means (FR-004, FR-005, FR-008, FR-009; contracts/numeric-control.md).
 *
 * Expectations build grouped numbers through `formatGrouped`, never a literal "1,024": the separator is the active
 * locale's (constitution 4.5.0), so a hard-coded comma would pass on one machine and fail on the next.
 */
import { describe, expect, it } from 'vitest';
import {
  checkTyped,
  clampToHard,
  formatGrouped,
  formatSetting,
  isStop,
  nearestStop,
  toDisplay,
  type FieldDescriptor,
} from '../../src/index.js';

const MiB = 1024 * 1024;
const g = (n: number): string => formatGrouped(n);

function d(over: Partial<FieldDescriptor>): FieldDescriptor {
  return { key: 'x.y', label: 'X', description: '', group: 'G', control: 'slider', ...over };
}

const size = d({ storedUnit: 'bytes', display: 'MB', min: 5 * MiB, max: 250 * MiB, step: 5 * MiB, hardMin: 1024, hardMax: 2048 * MiB });
const fast = d({ storedUnit: 'ms', display: 'ms', min: 0, max: 1500, step: 25, hardMax: 10_000 });
const secs = d({ storedUnit: 'ms', display: 's', min: 0, max: 10_000, step: 500 });
const mins = d({ storedUnit: 'ms', display: 'min', min: 60_000, max: 1_800_000, step: 60_000 });
const days = d({ storedUnit: 'ms', display: 'days', min: 86_400_000, max: 30 * 86_400_000, step: 86_400_000 });
const chars = d({ storedUnit: 'characters', display: 'own', min: 10, max: 200, step: 5 });
const pct = d({ storedUnit: 'percent', display: 'own', min: 1, max: 100, step: 1 });
const rows = d({ storedUnit: 'count', display: 'own', unitLabel: 'entries', min: 1, max: 50, step: 1 });

describe('toDisplay — the value in the unit the slider is shown in', () => {
  it('shows a size in MB, to at most two decimal places', () => {
    expect(toDisplay(25 * MiB, size)).toBe(`${g(25)} MB`);
    expect(toDisplay(12_345_678, size)).toBe(`${g(11.77)} MB`);
    expect(toDisplay(2048 * MiB, size)).toBe(`${g(2048)} MB`);
  });

  it('shows a duration in ms, s, min or days, as declared', () => {
    expect(toDisplay(125, fast)).toBe(`${g(125)} ms`);
    expect(toDisplay(1500, secs)).toBe(`${g(1.5)} s`);
    expect(toDisplay(300_000, mins)).toBe(`${g(5)} min`);
    expect(toDisplay(3 * 86_400_000, days)).toBe(`${g(3)} days`);
    expect(toDisplay(86_400_000, days)).toBe(`${g(1)} day`);
  });

  it('shows its own unit for counts, lengths and percentages', () => {
    expect(toDisplay(40, chars)).toBe(`${g(40)} characters`);
    expect(toDisplay(80, pct)).toBe(`${g(80)}%`);
    expect(toDisplay(10, rows)).toBe(`${g(10)} entries`);
  });
});

describe('formatSetting — what a notice or description quotes', () => {
  it('names the stored value beside the display value where the two differ', () => {
    expect(formatSetting(25 * MiB, size)).toBe(`${g(25)} MB (${g(25 * MiB)} bytes)`);
    expect(formatSetting(1500, secs)).toBe(`${g(1.5)} s`);
    expect(formatSetting(125, fast)).toBe(`${g(125)} ms`);
  });
});

describe('stops', () => {
  it('is a stop on the slider grid, and not off it or outside it', () => {
    expect(isStop(10 * MiB, size)).toBe(true);
    expect(isStop(12_345_678, size)).toBe(false);
    expect(isStop(300 * MiB, size)).toBe(false);
    expect(isStop(1024, size)).toBe(false);
  });

  it('finds the nearest stop, within the slider range', () => {
    expect(nearestStop(12_345_678, size)).toBe(10 * MiB);
    expect(nearestStop(13 * MiB, size)).toBe(15 * MiB);
    expect(nearestStop(900 * MiB, size)).toBe(250 * MiB);
    expect(nearestStop(1024, size)).toBe(5 * MiB);
  });
});

describe('checkTyped — the box, as the user types', () => {
  it('accepts any whole number within the hard bounds, grouped or not', () => {
    expect(checkTyped(g(12_345_678), size)).toEqual({ ok: true, value: 12_345_678 });
    expect(checkTyped('12345678', size)).toEqual({ ok: true, value: 12_345_678 });
    expect(checkTyped(g(2048 * MiB), size)).toEqual({ ok: true, value: 2048 * MiB });
  });

  it('names the hard maximum above it and clamps to it', () => {
    expect(checkTyped('999999999999', size)).toEqual({
      ok: false,
      message: `Up to ${g(2048 * MiB)} bytes`,
      clampTo: 2048 * MiB,
    });
  });

  it('names the hard minimum below it and clamps to it', () => {
    expect(checkTyped('10', size)).toEqual({ ok: false, message: `At least ${g(1024)} bytes`, clampTo: 1024 });
    expect(checkTyped('-5', fast)).toEqual({ ok: false, message: `At least ${g(0)} ms`, clampTo: 0 });
  });

  it('falls back to the slider range where no hard bound is declared', () => {
    expect(checkTyped('201', chars)).toEqual({ ok: false, message: `Up to ${g(200)} characters`, clampTo: 200 });
  });

  it('refuses what is not a whole number, with nothing to clamp to', () => {
    expect(checkTyped('abc', size)).toEqual({ ok: false, message: 'Not a whole number' });
    expect(checkTyped('1.5', fast)).toEqual({ ok: false, message: 'Not a whole number' });
    expect(checkTyped('', fast)).toEqual({ ok: false, message: 'Not a whole number' });
  });
});

describe('clampToHard', () => {
  it('holds a value to the hard bounds and leaves one inside them alone', () => {
    expect(clampToHard(3000 * MiB, size)).toBe(2048 * MiB);
    expect(clampToHard(1, size)).toBe(1024);
    expect(clampToHard(12_345_678, size)).toBe(12_345_678);
    expect(clampToHard(5000, fast)).toBe(5000);
  });
});
