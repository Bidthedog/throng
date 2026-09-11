import { describe, expect, it } from 'vitest';
import { groupRows, orderGroups, snippetFor, type ResultGroup, type ResultRow } from '@throng/core';

/**
 * 043 T007 / FR-035 — result ordering.
 *
 * "At each level, files in alphanumeric order (digits before letters), then sub-directories in
 * alphanumeric order, each expanded the same way."
 *
 * ══ WHY THIS IS NOT A SORT BY PATH STRING ══
 *
 * Sorting the full root-relative paths as plain strings looks like it would do, and it fails on the
 * only case anyone cares about: `src/z.ts` sorts after `src/a/b.ts`, putting a directory's own file
 * BELOW a file inside one of its sub-directories. The rule is per LEVEL, so the comparison has to
 * know where one path ends and another keeps descending — which is exactly what the fixture below
 * pins, at the root and again inside `src`.
 */

const row = (relPath: string, line: number, column: number): ResultRow => ({
  relPath,
  line,
  column,
  from: line * 100 + column,
  to: line * 100 + column + 3,
  snippet: snippetFor('one hit here', column - 1, column + 2),
});

const keys = (groups: readonly ResultGroup[]): string[] => groups.map((g) => g.key);

describe('orderGroups (FR-035)', () => {
  // Deliberately shuffled, and deliberately containing every collision the rule has to settle:
  // a digit-named file against letter-named ones, a directory's own file against a file nested
  // below it, and a root-level file against a root-level directory.
  const rows = [
    row('z/inner.ts', 1, 1),
    row('src/a/b.ts', 1, 1),
    row('b.ts', 1, 1),
    row('src/z.ts', 1, 1),
    row('a/deep.ts', 1, 1),
    row('1.ts', 1, 1),
    row('a.ts', 1, 1),
  ];

  it('puts a level’s own files before its sub-directories, at every level', () => {
    expect(keys(orderGroups(groupRows(rows, 'file')))).toEqual([
      // Root's own files, alphanumeric — the digit first.
      '1.ts',
      'a.ts',
      'b.ts',
      // Then root's sub-directories, alphanumeric.
      'a/deep.ts',
      // …and inside `src` the same rule applies again: its own file, then its sub-directory.
      'src/z.ts',
      'src/a/b.ts',
      'z/inner.ts',
    ]);
  });

  // FR-073 withdrew per-folder grouping, and the case that asserted folder-heading ORDER on its own
  // went with it: `fileAndFolder` emits the same top-level keys, and the case below already pins
  // them. Two cases making one claim over one surviving grouping is a duplicate, not coverage.
  it('orders the files inside each folder heading (per file and folder)', () => {
    const groups = orderGroups(groupRows(rows, 'fileAndFolder'));
    expect(keys(groups)).toEqual(['', 'a', 'src', 'src/a', 'z']);
    expect(keys(groups[0].children)).toEqual(['1.ts', 'a.ts', 'b.ts']);
    expect(keys(groups[2].children)).toEqual(['src/z.ts']);
  });

  it('orders the rows within a group by position in the file', () => {
    const shuffled = [row('one.ts', 9, 2), row('one.ts', 1, 5), row('one.ts', 1, 2)];
    const [group] = orderGroups(groupRows(shuffled, 'file'));
    expect(group.rows.map((r) => [r.line, r.column])).toEqual([
      [1, 2],
      [1, 5],
      [9, 2],
    ]);
  });

  it('orders rows spanning several files by file first, then position', () => {
    /*
     * FR-035's file order has to hold WITHIN a group as well as between groups, and `orderGroups` is
     * an exported total function over a group tree — so the group is built here rather than obtained
     * from `groupRows`. No surviving grouping produces one: FR-073 withdrew `'folder'`, which was the
     * only shape that hung several files' rows off one heading. What is left is the comparator's own
     * contract, which the panel would meet again the moment any caller hands it a mixed group.
     */
    const mixed: ResultGroup = {
      key: '',
      kind: 'folder',
      matchCount: 3,
      stale: false,
      rows: [row('b.ts', 2, 1), row('1.ts', 5, 1), row('b.ts', 1, 1)],
      children: [],
    };
    const [group] = orderGroups([mixed]);
    expect(group.rows.map((r) => [r.relPath, r.line])).toEqual([
      ['1.ts', 5],
      ['b.ts', 1],
      ['b.ts', 2],
    ]);
  });
});
