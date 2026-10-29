import { describe, expect, it } from 'vitest';
import { minimumIntervalFor, raisedIntervalFor } from '../../../src/resources/settings-resolution.js';

// FR-004b: the interval to store when the history window changes.
describe('raisedIntervalFor', () => {
  it.each([
    [5, 2, undefined],
    [10, 2, 5],
    [20, 2, 15],
    [30, 2, 30],
    [30, 10, 30],
  ])('a %i-minute window with a stored %i s interval → %s', (minutes, stored, expected) => {
    expect(raisedIntervalFor(minutes, stored)).toBe(expected);
  });

  it('leaves an interval that meets the minimum, or exceeds it, alone', () => {
    expect(raisedIntervalFor(30, 30)).toBeUndefined();
    expect(raisedIntervalFor(10, 60)).toBeUndefined();
  });

  it('never proposes anything but the band\'s own minimum', () => {
    for (const minutes of [1, 5, 6, 10, 11, 20, 21, 30]) {
      const raised = raisedIntervalFor(minutes, 2);
      if (raised !== undefined) expect(raised).toBe(minimumIntervalFor(minutes));
    }
  });
});
