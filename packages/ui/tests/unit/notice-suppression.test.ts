import { describe, it, expect } from 'vitest';
import {
  pruneSilenced,
  rememberSilenced,
  shouldSuppressForCause,
  shouldSuppressSilenced,
  silencedCauseKeys,
  silencedGrowth,
  silencedNoticeKey,
  unreportedPanels,
  type SilencedNotices,
} from '../../src/renderer/common/notice-suppression.js';

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

/**
 * 030 FR-005b/FR-005c — the shadow behind a severity the user set to *Never display*.
 *
 * The rules above are bounded by the LIVE notice list, which a silenced notice never joins. Left at
 * that, both checks compare a silenced repeat against nothing, and one unchanged failure re-reported
 * by a watcher writes a log record per repeat — so a severity turned OFF is louder in the record
 * than the same events displayed, which is SC-003 false in the direction nobody looks at.
 */
const WARN = { severity: 'warning', message: 'Another panel is already called “Build”.' };

describe('the silenced shadow keys on the group, not the tuple (FR-005b)', () => {
  it('prefers the group key, so one message from two operations is two events', () => {
    const a = silencedNoticeKey({ ...WARN, groupKey: 'path-missing:Docs::p1' });
    const b = silencedNoticeKey({ ...WARN, groupKey: 'path-missing:Docs::p2' });
    // Identical prose, different projects. The DISPLAYED path raises both (FR-037a); a tuple-keyed
    // shadow would suppress the second silently, which is the parity this exists to keep.
    expect(a).not.toBe(b);
  });

  it('falls back to the duplicate tuple when there is no group key', () => {
    expect(silencedNoticeKey(WARN)).toBe(silencedNoticeKey({ ...WARN }));
    expect(silencedNoticeKey(WARN)).not.toBe(silencedNoticeKey({ ...WARN, testId: 'explorer-error' }));
    expect(silencedNoticeKey(WARN)).not.toBe(silencedNoticeKey({ ...WARN, message: 'something else' }));
    expect(silencedNoticeKey(WARN)).not.toBe(silencedNoticeKey({ ...WARN, severity: 'error' }));
  });

  it('is never the cause key alone — that drops the project the group key carries', () => {
    // A regression guard with a name: keying on `causeKey` would collapse one absent folder across
    // every project open at once, which is exactly what `groupKey` appends the project id to prevent.
    expect(silencedNoticeKey({ ...WARN, groupKey: 'path-missing:Docs::p1' })).toContain('p1');
  });
});

describe('the shadow suppresses a repeat and expires on its own dwell (FR-005b)', () => {
  const map = (): SilencedNotices => new Map();

  it('suppresses the same event raised again inside the window', () => {
    const m = map();
    const key = silencedNoticeKey(WARN);
    rememberSilenced(m, key, { expiresAt: 1_000 });
    expect(shouldSuppressSilenced(m, key, [], 500)).toBe(true);
  });

  it('says nothing about an event it has never seen', () => {
    const m = map();
    rememberSilenced(m, silencedNoticeKey(WARN), { expiresAt: 1_000 });
    expect(shouldSuppressSilenced(m, silencedNoticeKey({ ...WARN, message: 'other' }), [], 500)).toBe(
      false,
    );
  });

  it('stops suppressing once the dwell the notice would have had is over', () => {
    const m = map();
    const key = silencedNoticeKey(WARN);
    rememberSilenced(m, key, { expiresAt: 1_000 });
    expect(shouldSuppressSilenced(m, key, [], 1_000)).toBe(false);
    expect(shouldSuppressSilenced(m, key, [], 5_000)).toBe(false);
  });

  it('is pruned lazily, so it needs no timer of its own', () => {
    const m = map();
    rememberSilenced(m, 'a', { expiresAt: 1_000 });
    rememberSilenced(m, 'b', { expiresAt: 9_000 });
    pruneSilenced(m, 2_000);
    expect([...m.keys()]).toEqual(['b']);
  });

  it('carries its cause into the cause rule, so one cause is one notice either way', () => {
    const m = map();
    rememberSilenced(m, 'a', { expiresAt: 9_000, causeKey: 'path-missing:Docs' });
    rememberSilenced(m, 'b', { expiresAt: 1_000, causeKey: 'held:Build' });
    // Expired entries speak for nothing, and an unclassified failure is not a cause.
    expect(silencedCauseKeys(m, 2_000)).toEqual(['path-missing:Docs']);
    expect(shouldSuppressForCause(silencedCauseKeys(m, 2_000), 'path-missing:Docs')).toBe(true);
    expect(shouldSuppressForCause(silencedCauseKeys(m, 2_000), 'held:Build')).toBe(false);
  });
});

describe('the shadow suppresses only a notice reporting nothing new (FR-005c)', () => {
  it('lets a notice naming a panel it has not reported through', () => {
    const m: SilencedNotices = new Map();
    rememberSilenced(m, 'g', { expiresAt: 9_000, panelIds: ['p1', 'p2'] });
    expect(unreportedPanels(m, 'g', ['p1', 'p2'])).toEqual([]);
    expect(unreportedPanels(m, 'g', ['p2', 'p3'])).toEqual(['p3']);
    // The duplicate key contains nothing that changes when a cause claims further panels, so without
    // this clause the shadow swallows exactly the growth records the displayed path emits (FR-006a).
    expect(shouldSuppressSilenced(m, 'g', ['p1'], 0)).toBe(true);
    expect(shouldSuppressSilenced(m, 'g', ['p3'], 0)).toBe(false);
  });

  it('merges the newly reported panels rather than replacing them', () => {
    const m: SilencedNotices = new Map();
    rememberSilenced(m, 'g', { expiresAt: 9_000, panelIds: ['p1'] });
    rememberSilenced(m, 'g', { expiresAt: 9_000, panelIds: ['p2'] });
    expect(shouldSuppressSilenced(m, 'g', ['p1', 'p2'], 0)).toBe(true);
  });

  it('treats a notice naming no panels as reporting nothing new', () => {
    // Every notice until US3 gives `NoticeInput` its `affected` list. The ordinary duplicate rule
    // must apply to those unchanged, or the shadow would never suppress anything at all.
    const m: SilencedNotices = new Map();
    rememberSilenced(m, 'k', { expiresAt: 9_000 });
    expect(shouldSuppressSilenced(m, 'k', [], 0)).toBe(true);
  });
});

describe('a silenced growth records what a displayed one would (FR-005c)', () => {
  /*
   * FR-005c requires the silenced record to match the displayed growth record IN CONTENT AS WELL AS
   * IN COUNT. Getting the first half right and the second half wrong is what it read like before:
   * two casualties of one cause each filed `affected=1` naming their own panel, which in the log is
   * indistinguishable from two unrelated failures — the exact reading the count exists to prevent.
   */
  it('names only what joined, and counts everything the key holds', () => {
    const m: SilencedNotices = new Map();

    // The first casualty: nothing has been reported, so this is a first report and not a growth.
    const first = silencedGrowth(m, 'g', ['p1'], 0);
    expect(first).toEqual({ unreported: ['p1'], total: 1, grew: false });
    rememberSilenced(m, 'g', { expiresAt: 9_000, panelIds: ['p1'] });

    // The second: one panel joins, and the notice now speaks for two — which is what the DISPLAYED
    // path's `mergeAffected(existing, incoming).length` says at the same moment.
    const second = silencedGrowth(m, 'g', ['p2'], 0);
    expect(second).toEqual({ unreported: ['p2'], total: 2, grew: true });
  });

  it('counts a re-reported panel once, however many times the raise names it', () => {
    const m: SilencedNotices = new Map();
    rememberSilenced(m, 'g', { expiresAt: 9_000, panelIds: ['p1'] });
    // A raise carrying the whole list rather than the delta — which is what a reporter that rebuilds
    // its casualties from the layout sends. Only `p2` is new; the total is still two, not three.
    expect(silencedGrowth(m, 'g', ['p1', 'p2'], 0)).toEqual({
      unreported: ['p2'],
      total: 2,
      grew: true,
    });
  });

  it('an expired entry makes the next raise a first report again', () => {
    // The dwell is the window inside which the event is the same event (FR-005b). Past it, a reader
    // of the log is looking at something new, and a growth record over a count nobody can see the
    // start of would be worse than a fresh one.
    const m: SilencedNotices = new Map();
    rememberSilenced(m, 'g', { expiresAt: 1_000, panelIds: ['p1'] });
    expect(silencedGrowth(m, 'g', ['p2'], 5_000)).toEqual({
      unreported: ['p2'],
      total: 1,
      grew: false,
    });
  });
});
