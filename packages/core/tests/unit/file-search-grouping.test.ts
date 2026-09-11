import { describe, expect, it } from 'vitest';
import {
  groupRows,
  orderGroups,
  snippetFor,
  type Grouping,
  type ResultGroup,
  type ResultRow,
} from '@throng/core';

/**
 * 043 T009 / FR-033 and FR-034a — regrouping, and results that open expanded.
 *
 * ══ WHAT THE PURE LAYER CAN ACTUALLY PROVE ══
 *
 * FR-033 says switching the grouping must not re-run the search. That is a claim about a FUNCTION
 * OF THE ROWS: if both groupings are derivable from one row set, the panel has no reason to
 * scan again, and the component test can then assert it does not. The assertion here is therefore
 * that the same rows go in and every match comes back out under each grouping — no grouping may
 * drop, duplicate or invent a row.
 *
 * ══ TWO GROUPINGS, NOT THREE (043 T144, FR-073) ══
 *
 * `'folder'` was withdrawn. It bucketed rows straight onto a folder heading, so a row's only clue to
 * which file it came from was a `title` attribute — and `groupRows` is where that shape was built.
 * The claim that replaces the deleted cases is stated positively below, because "the branch is gone"
 * is invisible from outside a pure function: under EVERY surviving grouping, every row sits beneath a
 * heading whose `kind` is `'file'` and whose key names that file.
 *
 * FR-034a says results open expanded. Expansion is a view concern, so the half that belongs here is
 * the half that makes the view's job possible: every row is PRESENT in the returned structure at
 * every grouping, and the model carries no collapsed/expanded state of its own to default wrongly.
 * A grouping that stood one row for a whole file would make "all of its occurrences visible"
 * unimplementable no matter what the panel did.
 */

const row = (relPath: string, line: number): ResultRow => ({
  relPath,
  line,
  column: 1,
  from: line * 10,
  to: line * 10 + 3,
  snippet: snippetFor('a hit', 2, 5),
});

/** Every row reachable in the structure, at whatever depth it sits. */
function flatten(groups: readonly ResultGroup[]): ResultRow[] {
  return groups.flatMap((g) => [...g.rows, ...flatten(g.children)]);
}

const rows = [
  row('a.ts', 1),
  row('a.ts', 7),
  row('a.ts', 9),
  row('src/b.ts', 2),
  row('src/c.ts', 3),
  row('src/deep/d.ts', 4),
];

const ALL: Grouping[] = ['file', 'fileAndFolder'];

/** Every heading in the tree, at whatever depth it sits. */
function headings(groups: readonly ResultGroup[]): ResultGroup[] {
  return groups.flatMap((g) => [g, ...headings(g.children)]);
}

describe('groupRows (FR-033 — regrouping never needs a rescan)', () => {
  it.each(ALL)('reaches every match under %s grouping, exactly once', (grouping) => {
    const flat = flatten(orderGroups(groupRows(rows, grouping)));
    expect(flat).toHaveLength(rows.length);
    expect([...flat].sort((x, y) => x.from - y.from)).toEqual([...rows].sort((x, y) => x.from - y.from));
  });

  it('is a pure function of the rows — two shapes, one input, no rescan', () => {
    const shapes = ALL.map((g) => orderGroups(groupRows(rows, g)).map((x) => x.key));
    expect(shapes[0]).toEqual(['a.ts', 'src/b.ts', 'src/c.ts', 'src/deep/d.ts']);
    expect(shapes[1]).toEqual(['', 'src', 'src/deep']);
  });

  it.each(ALL)('hangs every row off a heading that NAMES its file, under %s (FR-073)', (grouping) => {
    /*
     * The property the withdrawn grouping broke, stated so that re-adding it fails here rather than
     * in a maintainer's hands. A row carries no file name of its own — its `relPath` reaches the
     * reader only through the heading above it — so a heading that is not the row's file is a row
     * whose origin is unreadable.
     */
    for (const heading of headings(orderGroups(groupRows(rows, grouping)))) {
      if (heading.rows.length === 0) continue;
      expect(heading.kind).toBe('file');
      expect(heading.rows.every((r) => r.relPath === heading.key)).toBe(true);
    }
  });

  it('nests file groups under folder headings ONLY for per file and folder', () => {
    expect(groupRows(rows, 'file').every((g) => g.children.length === 0)).toBe(true);

    const nested = orderGroups(groupRows(rows, 'fileAndFolder'));
    expect(nested.map((g) => g.kind)).toEqual(['folder', 'folder', 'folder']);
    // A folder heading holds no rows of its own; its files do.
    expect(nested.every((g) => g.rows.length === 0)).toBe(true);
    expect(nested[1].children.map((c) => c.key)).toEqual(['src/b.ts', 'src/c.ts']);
    expect(nested[1].children.every((c) => c.kind === 'file')).toBe(true);
  });

  it('counts the matches a group holds, including the ones nested below it', () => {
    const byFile = groupRows(rows, 'file');
    expect(byFile.find((g) => g.key === 'a.ts')?.matchCount).toBe(3);

    const nested = orderGroups(groupRows(rows, 'fileAndFolder'));
    // `src` holds two files with one match each — the heading's count is the sum, so a collapsed
    // group can still say how many matches it holds (FR-034).
    expect(nested[1].matchCount).toBe(2);
    expect(nested[0].matchCount).toBe(3);
  });
});

describe('FR-034a — every occurrence is its own visible row', () => {
  it('gives a file with three matches three rows, not one standing for the file', () => {
    const [group] = groupRows([row('a.ts', 1), row('a.ts', 7), row('a.ts', 9)], 'file');
    expect(group.rows).toHaveLength(3);
    expect(group.rows.map((r) => r.line)).toEqual([1, 7, 9]);
  });

  it.each(ALL)('carries no collapsed/expanded state of its own under %s grouping', (grouping) => {
    // If the model owned this flag, "results open expanded" would depend on its default, and a
    // grouping switch would be free to reset it. It does not own it: the panel does.
    for (const group of groupRows(rows, grouping)) {
      expect(Object.keys(group).sort()).toEqual([
        'children',
        'kind',
        'key',
        'matchCount',
        'rows',
        'stale',
      ].sort());
    }
  });

  it('produces nothing at all from no rows, rather than an empty heading', () => {
    for (const grouping of ALL) expect(groupRows([], grouping)).toEqual([]);
  });
});
