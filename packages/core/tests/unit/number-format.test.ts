import { describe, expect, it } from 'vitest';

import { formatGrouped, parseGrouped } from '../../src/index.js';

/**
 * 018 / FR-037, FR-038 — digit grouping is strictly a VIEW concern.
 *
 * The maximum-openable-file-size setting displayed as `10485760` — eight digits with no grouping,
 * which nobody reads as ten megabytes.
 *
 * The dangerous half is the inverse: a grouping character must NEVER reach a stored value, a
 * settings file or a theme file. A parser that assumed a comma would corrupt a value under any
 * locale that groups with a full stop — and it would do so silently, in a file, which is the worst
 * place for a bug to live.
 */
describe('formatGrouped (FR-037)', () => {
  it('groups a large number so it can be read at a glance', () => {
    expect(formatGrouped(10485760, 'en-GB')).toBe('10,485,760');
  });

  it('does NOT group a small one', () => {
    // "Large-magnitude" was undefined in the specification, and that is not a detail: grouping
    // everything renders a 5000 ms delay as `5,000` and a 1024-byte floor as `1,024`, which read as
    // typos rather than kindnesses.
    expect(formatGrouped(5000, 'en-GB')).toBe('5000');
    expect(formatGrouped(1024, 'en-GB')).toBe('1024');
    expect(formatGrouped(13, 'en-GB')).toBe('13');
  });
});

describe('parseGrouped is the EXACT inverse of formatGrouped (FR-038)', () => {
  const values = [0, 13, 300, 1024, 5000, 10485760, 2147483647];

  it('round-trips under a comma-grouping locale', () => {
    for (const v of values) {
      expect(parseGrouped(formatGrouped(v, 'en-GB'), 'en-GB'), `${v} must survive`).toBe(v);
    }
  });

  it('round-trips under a locale that groups with a FULL STOP', () => {
    // de-DE groups with `.` and marks decimals with `,` — the exact reversal that a comma-assuming
    // parser turns into a corrupted settings file.
    for (const v of values) {
      expect(parseGrouped(formatGrouped(v, 'de-DE'), 'de-DE'), `${v} must survive`).toBe(v);
    }
  });

  it('round-trips under a locale that groups with a SPACE', () => {
    for (const v of values) {
      expect(parseGrouped(formatGrouped(v, 'fr-FR'), 'fr-FR'), `${v} must survive`).toBe(v);
    }
  });

  it('accepts a number the user typed WITHOUT grouping', () => {
    // Nobody types the separators. The field must take what a person actually writes.
    expect(parseGrouped('10485760', 'en-GB')).toBe(10485760);
    expect(parseGrouped('  300  ', 'en-GB')).toBe(300);
  });

  it('rejects what is not a number, so the last valid value can stand', () => {
    for (const bad of ['', '   ', 'abc', '1,2,3,4x', '#10', '1e5x']) {
      expect(parseGrouped(bad, 'en-GB'), `${JSON.stringify(bad)} must be rejected`).toBeNull();
    }
  });

  it('never lets a grouping character reach the parsed value', () => {
    // The whole of FR-038 in one line: what comes out is a plain number, whatever went in.
    const parsed = parseGrouped('10,485,760', 'en-GB');
    expect(parsed).toBe(10485760);
    expect(String(parsed)).not.toMatch(/[,. ]/);
  });
});
