/**
 * Bounding the persisted undo history (016, FR-027a · T089).
 *
 * The cap exists to protect the 400 ms debounce the recovery snapshot is written on: a history that
 * grew without limit would eventually make every keystroke serialise megabytes of JSON, and the
 * component it would slow down is precisely the one whose job is to survive a crash.
 */
import { describe, expect, it } from 'vitest';
import {
  boundHistory,
  MAX_HISTORY_BYTES,
  type SerialisedUndoEntry,
} from '../../src/editor/undo-persistence.js';

/** An entry of roughly `size` bytes once serialised. */
function entry(id: number, size = 100): SerialisedUndoEntry {
  return {
    changes: { pad: 'x'.repeat(Math.max(0, size)) },
    inverted: null,
    selectionBefore: null,
    viewId: `v${id}`,
    version: id,
    mergeClass: null,
    at: id,
  };
}

describe('the cap', () => {
  it('is 1 MiB, and it is a CONSTANT — not a setting', () => {
    // Named here because FR-027a asked for a bound without naming one, and an unnamed bound is a
    // magic number waiting to be chosen differently in two places.
    expect(MAX_HISTORY_BYTES).toBe(1_048_576);
  });

  it('leaves a history that already fits completely alone', () => {
    const history = { undo: [entry(1), entry(2)], redo: [entry(3)] };
    expect(boundHistory(history)).toEqual(history);
  });
});

/** The cap is in BYTES of serialised JSON, so the budgets below are derived, never guessed. */
const bytes = (...entries: SerialisedUndoEntry[]): number =>
  entries.reduce((sum, e) => sum + JSON.stringify(e).length, 0);

describe('when it does not fit', () => {
  it('drops the OLDEST entries first — the recent past is what Ctrl+Z reaches for', () => {
    // Four entries into a budget with room for exactly two: the two oldest go, the two most recent
    // stay. A user who crashes mid-edit wants the last few steps back, not the first few.
    const history = { undo: [entry(1), entry(2), entry(3), entry(4)], redo: [] };
    const bounded = boundHistory(history, bytes(entry(3), entry(4)));

    expect(bounded.undo.map((e) => e.version)).toEqual([3, 4]);
  });

  it('trims the UNDO stack before the redo branch', () => {
    // A redo branch only exists while the user is stepping back and forth through history they can
    // still see. If something has to go, it is the more expendable of the two.
    const history = { undo: [entry(1), entry(2)], redo: [entry(3)] };
    const bounded = boundHistory(history, bytes(entry(2), entry(3)));

    expect(bounded.undo.map((e) => e.version)).toEqual([2]);
    expect(bounded.redo.map((e) => e.version)).toEqual([3]);
  });

  it('empties rather than exceeds — a single oversized entry does not sneak past the cap', () => {
    // The pathological case: one entry larger than the whole budget. Keeping it "because it is the
    // only one" would put an unbounded write back on the debounced path, which is the exact thing
    // the cap exists to prevent.
    const bounded = boundHistory({ undo: [entry(1, 5_000)], redo: [] }, 1_000);
    expect(bounded.undo).toEqual([]);
  });

  it('never mutates the history it was given', () => {
    const history = { undo: [entry(1), entry(2), entry(3)], redo: [] };
    boundHistory(history, 150);
    expect(history.undo).toHaveLength(3);
  });
});
