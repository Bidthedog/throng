import { describe, it, expect } from 'vitest';
import {
  shouldWatchForRecovery,
  watchTargetFor,
  reconnectsReleasedBy,
  type PendingReconnect,
} from '@throng/core';

/*
 * 039 US3 (#237) — terminals reconnect when their working directory comes back.
 *
 * At the unit layer, including the criterion that sounds like it needs a window. #237 asks that
 * terminals in tabs NEVER RENDERED in this session recover, and the property that delivers that is
 * "the watch is armed by the START FAILING, not by the panel rendering" — which is a fact about
 * when `shouldWatchForRecovery` is consulted, not about pixels. Asserting it here is both cheaper
 * and stricter than an E2E that opens two tabs and hopes.
 */
describe('what earns a path-availability watch (039 FR-030/FR-035)', () => {
  it('a start that failed because the directory is missing', () => {
    expect(shouldWatchForRecovery('path-missing')).toBe(true);
  });

  /*
   * FR-035 — the anti-thrash rule, and the reason it names these cases specifically.
   *
   * `permission-denied` is the exclusion worth arguing about, because it LOOKS recoverable: an ACL
   * can change and the path is right there in the error. But a directory watch fires on the
   * directory's CONTENTS, not on its ACL, so a watch armed for it either never fires or fires for
   * something unrelated. Neither is a recovery.
   */
  it('NOT a permission refusal — an ACL change is not something a directory watch can see', () => {
    expect(shouldWatchForRecovery('permission-denied')).toBe(false);
  });

  it('NOT a held handle, a non-empty directory, or a stopped daemon', () => {
    expect(shouldWatchForRecovery('held')).toBe(false);
    expect(shouldWatchForRecovery('not-empty')).toBe(false);
    expect(shouldWatchForRecovery('daemon-stopped')).toBe(false);
  });

  /*
   * An unclassified failure — a bad shell binary is the case #237 names. FR-011b reports its raw
   * message unchanged and this returns no cause at all. "We could not tell what went wrong" is not
   * evidence that the path is the problem, so it gets no watch and no retry.
   */
  it('NOT an unclassified failure (a bad shell binary, FR-011b)', () => {
    expect(shouldWatchForRecovery(null)).toBe(false);
    expect(shouldWatchForRecovery(undefined)).toBe(false);
  });
});

describe('where the watch is placed (039 FR-030)', () => {
  const parentOf = (p: string): string | null => {
    const i = p.lastIndexOf('/');
    return i <= 0 ? null : p.slice(0, i);
  };

  it('watches the directory itself when it exists', () => {
    const exists = (p: string): boolean => p === 'C:/proj/src';
    expect(watchTargetFor('C:/proj/src', exists, parentOf)).toBe('C:/proj/src');
  });

  /*
   * The case the feature exists for: the project root was renamed away, so the target does not
   * exist and neither does its immediate parent chain down to it. A watch can only be placed on
   * something that exists, so it walks up — and the rename BACK is what that ancestor observes.
   */
  it('walks up to the nearest existing ancestor when the target is gone', () => {
    const exists = (p: string): boolean => p === 'C:/dev';
    expect(watchTargetFor('C:/dev/proj/src', exists, parentOf)).toBe('C:/dev');
  });

  /*
   * Nothing in the chain exists — an unmounted drive, a disconnected share. There is nowhere to put
   * a watch, and saying so is better than pretending: FR-039's manual Retry stays available, which
   * is exactly the fallback it is for.
   */
  it('returns null when nothing in the chain exists — this one cannot self-recover', () => {
    expect(watchTargetFor('Z:/gone/deeper', () => false, parentOf)).toBeNull();
  });

  it('terminates on a parentOf that returns its own input at a root', () => {
    // A filesystem root whose parent is itself would spin forever on a depth-limit-free walk.
    // Guarded on identity, so this returns rather than hanging the caller.
    expect(watchTargetFor('C:/', () => false, (p) => p)).toBeNull();
  });
});

describe('which pending reconnects an event releases (039 FR-030/FR-031/FR-037)', () => {
  const pending = (over: Partial<PendingReconnect> = {}): PendingReconnect => ({
    panelId: 'p1',
    projectId: 'A',
    target: 'C:/dev/proj/src',
    watching: 'C:/dev',
    ...over,
  });

  const releases = (
    list: PendingReconnect[],
    event: { projectId: string; path: string },
    resolves: (t: string) => boolean = () => true,
  ): string[] => reconnectsReleasedBy(list, event, resolves).map((p) => p.panelId);

  it('releases a panel whose watched directory reported and whose target now resolves', () => {
    expect(releases([pending()], { projectId: 'A', path: 'C:/dev' })).toEqual(['p1']);
  });

  /*
   * FR-037 / Principle I — the isolation rule, and it is not hypothetical. Two projects under one
   * parent directory (a monorepo, `C:/dev/*`) watch the SAME path, so without the project filter a
   * rename in one would start the other's terminals.
   */
  it('does NOT cross projects, even when both watch the same directory', () => {
    const list = [pending({ panelId: 'a1', projectId: 'A' }), pending({ panelId: 'b1', projectId: 'B' })];
    expect(releases(list, { projectId: 'A', path: 'C:/dev' })).toEqual(['a1']);
  });

  /*
   * The watch is on an ANCESTOR, so "something changed under C:/dev" is not "my directory is back".
   * Without re-checking the target, creating an unrelated sibling folder would release every
   * terminal waiting on that parent and each would immediately fail again — the thrash FR-035
   * forbids, arriving through a different door.
   */
  it('does NOT release on an ancestor event that did not restore the target', () => {
    expect(releases([pending()], { projectId: 'A', path: 'C:/dev' }, () => false)).toEqual([]);
  });

  it('ignores an event for a directory nobody is watching', () => {
    expect(releases([pending()], { projectId: 'A', path: 'C:/elsewhere' })).toEqual([]);
  });

  /*
   * FR-032 — several panels, one restoration. They are released together because they were all
   * armed when the project loaded, across every tab, rendered or not. This is the "one
   * path-availability event" of the issue text, seen from the user's side: N watches, one moment.
   */
  it('releases every waiting panel in the project at once (FR-032)', () => {
    const list = [
      pending({ panelId: 'p1' }),
      pending({ panelId: 'p2' }),
      pending({ panelId: 'p3' }),
      pending({ panelId: 'other', projectId: 'B' }),
    ];
    expect(releases(list, { projectId: 'A', path: 'C:/dev' })).toEqual(['p1', 'p2', 'p3']);
  });
});
