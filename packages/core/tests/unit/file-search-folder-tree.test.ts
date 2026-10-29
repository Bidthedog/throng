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
 * 060 T001 — the Folder structure grouping (FR-012, FR-013, FR-013a, FR-014, FR-019).
 *
 * ══ WHAT IT MIRRORS, AND WHAT IT DOES NOT ══
 *
 * The shape is the File Explorer's: one heading per folder LEVEL, no merging of single-child chains,
 * folders before files, the explorer's own collation. That last point is the one that makes this a
 * third ordering rather than a third bucketing — 043 FR-035 puts a level's FILES first, and the two
 * shipped groupings keep doing so (FR-024), so the same comparator cannot serve all three.
 *
 * It is rooted at the search SCOPE, not the project: a search scoped to `packages/ui` opens on
 * `packages/ui`'s children, with no empty ancestor levels above them.
 */

const row = (relPath: string, from = 0): ResultRow => ({
  relPath,
  line: 1,
  column: from + 1,
  from,
  to: from + 3,
  snippet: snippetFor('one hit here', 0, 3),
});

const tree = (rows: readonly ResultRow[], scopeRel = '', order: 'natural' | 'characters' = 'natural') =>
  orderGroups(groupRows(rows, 'folderTree', { scopeRel }), order);

/** `kind:key` per heading, depth-first, the way the list reads them. */
const outline = (groups: readonly ResultGroup[], depth = 0): string[] =>
  groups.flatMap((g) => [`${'  '.repeat(depth)}${g.kind}:${g.key}`, ...outline(g.children, depth + 1)]);

describe('groupRows(…, "folderTree") — shape (FR-013)', () => {
  it('draws one heading per folder level, with files as leaves of their folder', () => {
    expect(outline(tree([row('src/a/b/c.ts'), row('src/a/d.ts')]))).toEqual([
      'folder:src',
      '  folder:src/a',
      '    folder:src/a/b',
      '      file:src/a/b/c.ts',
      '    file:src/a/d.ts',
    ]);
  });

  it('never merges a single-child chain into one heading', () => {
    // `deep/er/est` holds one file three levels down and nothing else — the case a "compact folders"
    // view would fold into one row, and the one FR-013 says must stay three.
    expect(outline(tree([row('deep/er/est/x.ts')]))).toEqual([
      'folder:deep',
      '  folder:deep/er',
      '    folder:deep/er/est',
      '      file:deep/er/est/x.ts',
    ]);
  });

  it('draws only folders that lead to a match', () => {
    const keys = outline(tree([row('a/x.ts'), row('b/c/y.ts')])).map((l) => l.trim());
    expect(keys).toEqual(['folder:a', 'file:a/x.ts', 'folder:b', 'folder:b/c', 'file:b/c/y.ts']);
  });

  it('puts a file at the scope root at the top level, under no folder heading', () => {
    expect(outline(tree([row('root.ts'), row('src/x.ts')]))).toEqual([
      'folder:src',
      '  file:src/x.ts',
      'file:root.ts',
    ]);
  });

  it('holds rows only in FILE groups (043 FR-073’s invariant)', () => {
    const walk = (groups: readonly ResultGroup[]): void => {
      for (const g of groups) {
        if (g.kind === 'folder') expect(g.rows).toEqual([]);
        else expect(g.rows.every((r) => r.relPath === g.key)).toBe(true);
        walk(g.children);
      }
    };
    walk(tree([row('a/b/x.ts', 0), row('a/b/x.ts', 10), row('a/y.ts'), row('z.ts')]));
  });

  it('counts everything beneath a folder heading (FR-013a)', () => {
    const [a] = tree([row('a/b/x.ts', 0), row('a/b/x.ts', 10), row('a/y.ts')]);
    expect(a.key).toBe('a');
    expect(a.matchCount).toBe(3);
    expect(a.children.find((g) => g.key === 'a/b')?.matchCount).toBe(2);
  });
});

describe('groupRows(…, "folderTree") — rooted at the search scope (R3)', () => {
  it('starts the tree below the scope, drawing no ancestor levels', () => {
    expect(outline(tree([row('packages/ui/src/a.ts'), row('packages/ui/b.ts')], 'packages/ui'))).toEqual([
      'folder:packages/ui/src',
      '  file:packages/ui/src/a.ts',
      'file:packages/ui/b.ts',
    ]);
  });

  it('draws a FILE scope (043 FR-092) as one top-level file heading, with no folder above it', () => {
    expect(outline(tree([row('packages/ui/a.ts')], 'packages/ui/a.ts'))).toEqual(['file:packages/ui/a.ts']);
  });

  it('keeps root-relative keys, so collapse state and staleness keep naming the same things', () => {
    const [src] = tree([row('packages/ui/src/a.ts')], 'packages/ui');
    expect(src.key).toBe('packages/ui/src');
    expect(src.children[0].key).toBe('packages/ui/src/a.ts');
  });
});

describe('orderGroups(…, explorer order) — the File Explorer’s order (FR-014)', () => {
  it('puts folders before files at every level, the opposite of 043 FR-035', () => {
    expect(outline(tree([row('a.ts'), row('b/c.ts'), row('b/a/d.ts')]))).toEqual([
      'folder:b',
      '  folder:b/a',
      '    file:b/a/d.ts',
      '  file:b/c.ts',
      'file:a.ts',
    ]);
  });

  it('follows the explorer’s sort order — runs of digits by value under natural, by character otherwise', () => {
    const rows = [row('f10.ts'), row('f9.ts'), row('f1.ts')];
    expect(outline(tree(rows, '', 'natural'))).toEqual(['file:f1.ts', 'file:f9.ts', 'file:f10.ts']);
    expect(outline(tree(rows, '', 'characters'))).toEqual(['file:f1.ts', 'file:f10.ts', 'file:f9.ts']);
  });

  it('orders a file’s rows by position', () => {
    const [file] = tree([row('x.ts', 20), row('x.ts', 5)]);
    expect(file.rows.map((r) => r.from)).toEqual([5, 20]);
  });

  it('leaves the two shipped groupings in 043 FR-035’s order (FR-024)', () => {
    const rows = [row('b/c.ts'), row('a.ts')];
    expect(orderGroups(groupRows(rows, 'file')).map((g) => g.key)).toEqual(['a.ts', 'b/c.ts']);
  });
});

describe('staleness under Folder structure (FR-019)', () => {
  it('marks the changed FILE heading and no folder heading', () => {
    const marked = markStale(tree([row('a/b/x.ts'), row('a/y.ts')]), ['a/b/x.ts']);
    const flags = (groups: readonly ResultGroup[]): string[] =>
      groups.flatMap((g) => [...(g.stale ? [g.key] : []), ...flags(g.children)]);
    expect(flags(marked)).toEqual(['a/b/x.ts']);
  });
});
