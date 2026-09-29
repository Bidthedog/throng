import { describe, it, expect } from 'vitest';
import { buildSymbolTree } from '../../src/outline/document-symbol.js';
import type { DocumentSymbol, HeadingRecord } from '../../src/outline/document-symbol.js';

/**
 * 047 T002 — the heading model shared by the preview outline, fold points and #375's editor outline
 * (data-model.md "DocumentSymbol", research R2). `buildSymbolTree` nests the flat, document-order
 * list the Markdown pipeline (and the editor's Lezer-tree walk) emits into the tree the outline and
 * fold derivation both read.
 */

const record = (level: HeadingRecord['level'], text: string, slug: string, line: number): HeadingRecord => ({
  level,
  text,
  slug,
  line,
});

describe('buildSymbolTree — nesting by level', () => {
  it('nests a heading under the nearest preceding heading of a lower level', () => {
    const flat: HeadingRecord[] = [
      record(1, 'Intro', 'intro', 0),
      record(2, 'Setup', 'setup', 2),
      record(3, 'Install', 'install', 4),
      record(2, 'Usage', 'usage', 6),
    ];
    const tree = buildSymbolTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'Intro', level: 1, line: 0, slug: 'intro' });
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children[0]).toMatchObject({ name: 'Setup', level: 2, slug: 'setup' });
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]).toMatchObject({ name: 'Install', level: 3, slug: 'install' });
    expect(tree[0]!.children[1]).toMatchObject({ name: 'Usage', level: 2, slug: 'usage' });
    expect(tree[0]!.children[1]!.children).toHaveLength(0);
  });

  it('a heading deeper than its predecessor by more than one level is still its child (h1 -> h4)', () => {
    const flat: HeadingRecord[] = [record(1, 'Top', 'top', 0), record(4, 'Deep', 'deep', 1)];
    const tree = buildSymbolTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]).toMatchObject({ name: 'Deep', level: 4, slug: 'deep' });
  });

  it('an empty list produces an empty tree', () => {
    expect(buildSymbolTree([])).toEqual<DocumentSymbol[]>([]);
  });

  it('preserves document order at each level', () => {
    const flat: HeadingRecord[] = [
      record(1, 'A', 'a', 0),
      record(1, 'B', 'b', 1),
      record(2, 'B.1', 'b-1', 2),
      record(2, 'B.2', 'b-2', 3),
      record(1, 'C', 'c', 4),
    ];
    const tree = buildSymbolTree(flat);
    expect(tree.map((s) => s.slug)).toEqual(['a', 'b', 'c']);
    expect(tree[1]!.children.map((s) => s.slug)).toEqual(['b-1', 'b-2']);
  });

  it('several top-level headings of the same level produce siblings, not nesting', () => {
    const flat: HeadingRecord[] = [record(2, 'X', 'x', 0), record(2, 'Y', 'y', 1)];
    const tree = buildSymbolTree(flat);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.children).toHaveLength(0);
    expect(tree[1]!.children).toHaveLength(0);
  });

  it('a lower-level heading after a nested one closes the nesting back up to it', () => {
    const flat: HeadingRecord[] = [
      record(1, 'A', 'a', 0),
      record(3, 'A.x', 'a-x', 1),
      record(2, 'A.y', 'a-y', 2),
      record(1, 'B', 'b', 3),
    ];
    const tree = buildSymbolTree(flat);
    expect(tree.map((s) => s.slug)).toEqual(['a', 'b']);
    expect(tree[0]!.children.map((s) => s.slug)).toEqual(['a-x', 'a-y']);
  });
});
