import { describe, expect, it } from 'vitest';
import {
  groupRows,
  markStale,
  orderGroups,
  snippetFor,
  type ResultGroup,
  type ResultRow,
} from '@throng/core';

/**
 * 043 T010 / FR-045a, FR-045b, FR-045c — staleness.
 *
 * Results are a snapshot. When a file that contributed results changes afterwards, THAT FILE is
 * marked — not the panel, and not its neighbours (FR-045a). The marking is informational only: it
 * disables, hides, greys and reorders nothing (FR-045b). Re-running clears it (FR-045c).
 *
 * ══ WHY FR-045b IS ASSERTED HERE AND NOT ONLY IN THE COMPONENT LAYER ══
 *
 * "Changes no row's presence, order or actionability" is easy to break in the MODEL rather than the
 * view — by filtering the changed file's rows out, by re-sorting stale groups to the bottom, or by
 * returning fresh row objects the panel can no longer match against what it is showing. All three
 * are invisible to a test that only checks the flag, so the shape is compared whole, before and
 * after, and the rows are compared by identity.
 */

const row = (relPath: string, line: number): ResultRow => ({
  relPath,
  line,
  column: 1,
  from: line * 10,
  to: line * 10 + 3,
  snippet: snippetFor('a hit here', 2, 5),
});

const rows = [row('a.ts', 1), row('a.ts', 4), row('src/b.ts', 2), row('src/c.ts', 3)];

const grouped = (): ResultGroup[] => orderGroups(groupRows(rows, 'file'));
const nested = (): ResultGroup[] => orderGroups(groupRows(rows, 'fileAndFolder'));

const staleKeys = (groups: readonly ResultGroup[]): string[] =>
  groups.flatMap((g) => [...(g.stale ? [g.key] : []), ...staleKeys(g.children)]);

describe('markStale (FR-045a — per file, never panel-wide)', () => {
  it('marks only the file that changed', () => {
    expect(staleKeys(markStale(grouped(), ['src/b.ts']))).toEqual(['src/b.ts']);
  });

  it('marks several files when several changed, and no others', () => {
    expect(staleKeys(markStale(grouped(), ['a.ts', 'src/c.ts'])).sort()).toEqual(['a.ts', 'src/c.ts']);
  });

  it('reaches a file group nested under a folder heading', () => {
    expect(staleKeys(markStale(nested(), ['src/c.ts']))).toEqual(['src/c.ts']);
  });

  it('does not mark the folder heading a stale file sits under', () => {
    // A folder is not a file, and "which files are affected and which are still trustworthy"
    // (FR-045a) is answered per file. A heading marked stale would say `src/b.ts` is suspect too.
    const marked = markStale(nested(), ['src/c.ts']);
    expect(marked.filter((g) => g.kind === 'folder').some((g) => g.stale)).toBe(false);
  });

  it('ignores a changed file that contributed no results', () => {
    expect(staleKeys(markStale(grouped(), ['never/searched.ts']))).toEqual([]);
  });
});

describe('markStale (FR-045b — informational only)', () => {
  const before = grouped();
  const after = markStale(before, ['a.ts']);

  it('changes no group’s presence or order', () => {
    expect(after.map((g) => g.key)).toEqual(before.map((g) => g.key));
  });

  it('changes no row’s presence, order or identity', () => {
    for (const [i, group] of after.entries()) {
      // Identity, not equality: the panel is holding these row objects, and handing it copies is
      // the quiet way a "purely informational" mark becomes a re-render of everything.
      expect(group.rows).toEqual(before[i].rows);
      group.rows.forEach((r, j) => expect(r).toBe(before[i].rows[j]));
    }
  });

  it('changes nothing about a group but its stale flag', () => {
    for (const [i, group] of after.entries()) {
      expect({ ...group, stale: before[i].stale }).toEqual(before[i]);
    }
  });
});

/*
 * ══ WHERE `clearStale` WENT (043 T117) ══
 *
 * There was a `clearStale(groups, rescanned)` here, exported from `@throng/core` and called by
 * nothing but the four tests that sat in this block. FR-045c — "re-running the search MUST clear
 * staleness for every file it re-scans" — is met without it, three times over, and none of the
 * three leaves a marked group for it to un-mark:
 *
 *   - the SERVICE forgets: `supersede()` clears the run's `staleFiles` and `held` before the new
 *     walk re-stamps anything, so a re-run's updates carry no staleness at all;
 *   - the RENDERER'S FOLD forgets: `applyFileSearchUpdate` treats a new generation as fresh and
 *     falls back to `[]` rather than to the previous set;
 *   - and the PANEL rebuilds: the groups are `markStale(orderGroups(groupRows(rows, grouping)))`
 *     on every render, from `groupRows`'s `stale: false`, so there is no surviving group object
 *     that could still be carrying a flag.
 *
 * `packages/ui/tests/component/find-in-files-staleness.test.ts` — "re-running clears staleness
 * (FR-045c, US3 scenario 16)" — is the assertion, at the tier where the requirement is observable.
 */
