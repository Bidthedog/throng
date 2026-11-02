/**
 * Settle async state without `waitFor`'s polling.
 *
 * `waitFor` re-checks on a DOM mutation or every 50 ms. A provider that loads config through a
 * resolved promise mutates no DOM when it finishes (the probe renders null), so `waitFor` always
 * sleeps to its next poll. Flushing microtasks inside `act` lets React commit the load straight
 * away; the bounded loop keeps the wait a condition rather than a guess.
 */
import { act } from '@testing-library/react';

export async function flushUntil(condition: () => boolean, maxTurns = 50): Promise<void> {
  for (let turn = 0; turn < maxTurns && !condition(); turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  if (!condition()) throw new Error(`flushUntil: condition still false after ${maxTurns} turns`);
}
