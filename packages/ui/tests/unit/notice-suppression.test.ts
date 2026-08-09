import { describe, it, expect } from 'vitest';
import { shouldSuppressForCause } from '../../src/renderer/common/notice-suppression.js';

/**
 * 029 FR-019 / FR-019b / FR-019c / FR-019d — one cause, one notice.
 *
 * Measured on master: a missing project root produces TWO notices for one absent folder — an
 * `ENOENT … realpath` from the file tree and an `Internal error: Cannot lock …` from a terminal.
 * The user has one problem and is told about it twice, in two vocabularies, neither of which names
 * the folder.
 *
 * The rule collapses failures **sharing a cause**, and nothing else. `notice-stacking.e2e.ts` proves
 * two DIFFERENT failures must still stack, so a rule that is too coarse breaks a shipped guarantee.
 */

describe('suppression collapses one cause (FR-019)', () => {
  it('suppresses a second failure whose cause is already reported', () => {
    expect(shouldSuppressForCause(['path-missing:Bravo'], 'path-missing:Bravo')).toBe(true);
  });

  it('finds the cause among SEVERAL live notices, not just the most recent', () => {
    /*
     * This test used to be byte-identical to the one above it — same arguments, same expectation —
     * so it could not fail independently and tested nothing its name claimed.
     *
     * What it should have been asking is whether the live set is really searched. Notices stack
     * (`notice-stacking.e2e.ts` exists because collapsing them was a bug), so by the time a cause
     * recurs its notice is rarely the last one raised. A rule that only compared against the newest
     * would suppress nothing in exactly the cascade FR-019 is about.
     */
    const live = ['held:Docs', 'path-missing:Bravo', 'daemon-stopped:throng'];
    expect(shouldSuppressForCause(live, 'held:Docs')).toBe(true);
    expect(shouldSuppressForCause(live, 'path-missing:Bravo')).toBe(true);
    expect(shouldSuppressForCause(live, 'not-empty:Docs')).toBe(false);
  });

  it('suppresses a watcher re-reporting the same failure while the notice stands (FR-019d)', () => {
    const live = ['held:Docs'];
    expect(shouldSuppressForCause(live, 'held:Docs')).toBe(true);
    expect(shouldSuppressForCause(live, 'held:Docs')).toBe(true);
  });
});

describe('suppression never collapses DIFFERENT causes (FR-019b)', () => {
  it('a different subject still raises', () => {
    expect(shouldSuppressForCause(['path-missing:Alpha'], 'path-missing:Bravo')).toBe(false);
  });

  it('a different kind on the same subject still raises', () => {
    expect(shouldSuppressForCause(['held:X'], 'permission-denied:X')).toBe(false);
  });

  it('an unrelated cause raises while another is live', () => {
    expect(shouldSuppressForCause(['daemon-stopped:throng'], 'held:Docs')).toBe(false);
  });
});

describe('suppression is bounded by the notice, not by a timer (FR-019c)', () => {
  it('nothing live means nothing suppressed — dismissal re-arms the cause', () => {
    // The caller passes the keys of LIVE notices. A dismissed notice is not in that list, so the
    // next failure attributable to it raises again. There is no clock here on purpose.
    expect(shouldSuppressForCause([], 'path-missing:Bravo')).toBe(false);
  });

  it('an empty key is never suppressed — an unclassified failure is not a cause', () => {
    // FR-011b: a failure matching none of the five kinds has no cause, so it keeps today's
    // behaviour. Suppressing on a falsy key would silently collapse unrelated raw errors.
    expect(shouldSuppressForCause(['path-missing:Bravo'], undefined)).toBe(false);
    expect(shouldSuppressForCause([''], '')).toBe(false);
  });
});
