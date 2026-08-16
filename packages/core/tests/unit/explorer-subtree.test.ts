import { describe, it, expect } from 'vitest';
import { descendantOpenFolders, immediateChildFolders, type ExpandNode } from '@throng/core';

/**
 * 033 US4 — the two pure subtree targets behind Collapse All Children and
 * Expand All Children (contracts/explorer-actions.md §B.1, C1–C5; spec
 * FR-039 – FR-042).
 *
 * C5 is why these helpers take `ExpandNode`, the view `expand.ts` already
 * defines: a second tree shape for the same tree is the duplication Principle
 * VIII forbids, so the fixtures below are built with the same helpers
 * `explorer-expand.test.ts` uses.
 */

const file = (relPath: string): ExpandNode => ({ relPath, kind: 'file', open: false });
const folder = (relPath: string, open: boolean, children?: ExpandNode[]): ExpandNode => ({
  relPath,
  kind: 'folder',
  open,
  // Closed folders carry no loaded children — exactly as the real tree behaves.
  children: open ? (children ?? []) : undefined,
});

/** root/ a(open){ a/b(open){ a/b/c(open){}, a/b/d(closed) }, a/e(closed) }, f(open){} */
const deepTree = (): ExpandNode =>
  folder('', true, [
    folder('a', true, [
      folder('a/b', true, [folder('a/b/c', true, [file('a/b/c/x.txt')]), folder('a/b/d', false)]),
      folder('a/e', false),
      file('a/y.txt'),
    ]),
    folder('f', true, [file('f/z.txt')]),
  ]);

describe('descendantOpenFolders (033 subtree.ts)', () => {
  it('C1 — excludes the anchor itself, so the folder stays open', () => {
    const targets = descendantOpenFolders(deepTree(), 'a');
    expect(targets).not.toContain('a');
  });

  it('C1 — excludes the root when the root is the anchor', () => {
    const targets = descendantOpenFolders(deepTree(), '');
    expect(targets).not.toContain('');
  });

  it('C2 — returns every open descendant at every depth', () => {
    expect([...descendantOpenFolders(deepTree(), 'a')].sort()).toEqual(['a/b', 'a/b/c']);
    expect([...descendantOpenFolders(deepTree(), '')].sort()).toEqual(['a', 'a/b', 'a/b/c', 'f']);
  });

  it('C2 — orders them deepest first, so closing is a single pass', () => {
    expect(descendantOpenFolders(deepTree(), 'a')).toEqual(['a/b/c', 'a/b']);
  });

  it('C2 — deepest first holds across sibling branches too', () => {
    const targets = descendantOpenFolders(deepTree(), '');
    const depth = (rel: string): number => rel.split('/').length;
    expect(targets).toEqual(['a/b/c', 'a/b', 'a', 'f']);
    for (let i = 1; i < targets.length; i += 1) {
      expect(depth(targets[i - 1])).toBeGreaterThanOrEqual(depth(targets[i]));
    }
  });

  it('C2 — a closed folder is never a target, however deep it sits', () => {
    const targets = descendantOpenFolders(deepTree(), '');
    expect(targets).not.toContain('a/e');
    expect(targets).not.toContain('a/b/d');
  });

  it('C2 — files are never targets', () => {
    expect(descendantOpenFolders(deepTree(), '')).not.toContain('a/y.txt');
    expect(descendantOpenFolders(deepTree(), 'f')).toEqual([]);
  });

  it('C3 — returns [] for a folder with nothing expanded beneath it', () => {
    const root = folder('', true, [folder('a', true, [folder('a/b', false), file('a/x.txt')])]);
    expect(descendantOpenFolders(root, 'a')).toEqual([]);
  });

  it('C3 — returns [] for an open but empty folder', () => {
    const root = folder('', true, [folder('a', true, [])]);
    expect(descendantOpenFolders(root, 'a')).toEqual([]);
  });

  /*
   * Named for what it actually proves. `descendantOpenFolders` never reads `anchor.open`, so the
   * empty result here comes from the VIEW and not from a guard: `folder()` above gives a closed
   * folder `children: undefined`, exactly as `toExpandNode` does in `use-explorer-data.ts`. That
   * makes this an assertion that the function is CORRECT UNDER its documented precondition, which
   * is a real thing to assert — it is not, and must not be read as, a guarantee that a closed
   * anchor is guarded independently of the tree it was given.
   */
  it('C3 — returns [] for a closed anchor, whose view carries no loaded children', () => {
    const root = folder('', true, [folder('a', false)]);
    expect(root.children?.[0].children, 'the precondition this rests on').toBeUndefined();
    expect(descendantOpenFolders(root, 'a')).toEqual([]);
  });

  it('returns [] for an anchor that is a file', () => {
    expect(descendantOpenFolders(deepTree(), 'a/y.txt')).toEqual([]);
  });

  it('returns [] for an anchor that is not in the tree', () => {
    expect(descendantOpenFolders(deepTree(), 'nowhere')).toEqual([]);
  });

  it('is pure — it does not mutate the tree it walked', () => {
    const root = deepTree();
    const before = JSON.stringify(root);
    descendantOpenFolders(root, '');
    expect(JSON.stringify(root)).toBe(before);
  });
});

describe('immediateChildFolders (033 subtree.ts)', () => {
  it('C4 — returns one level only; a grandchild is never included', () => {
    const targets = immediateChildFolders(deepTree(), 'a');
    expect(targets).toEqual(['a/b', 'a/e']);
    expect(targets).not.toContain('a/b/c');
    expect(targets).not.toContain('a/b/d');
  });

  it('C4 — from the root it returns the first level and no deeper', () => {
    expect(immediateChildFolders(deepTree(), '')).toEqual(['a', 'f']);
  });

  it('C4 — returns closed child folders as well as open ones; they are what Expand opens', () => {
    const targets = immediateChildFolders(deepTree(), 'a');
    expect(targets).toContain('a/e'); // closed
    expect(targets).toContain('a/b'); // already open
  });

  it('C4 — excludes files', () => {
    expect(immediateChildFolders(deepTree(), 'f')).toEqual([]);
  });

  it('C4 — preserves the tree order of the children', () => {
    const root = folder('', true, [folder('z', false), folder('a', false), folder('m', false)]);
    expect(immediateChildFolders(root, '')).toEqual(['z', 'a', 'm']);
  });

  it('returns [] for an open folder with no child folders', () => {
    const root = folder('', true, [folder('a', true, [file('a/x.txt'), file('a/y.txt')])]);
    expect(immediateChildFolders(root, 'a')).toEqual([]);
  });

  it('returns [] for a closed folder, whose children are not loaded yet (FR-042: the caller opens it first)', () => {
    const root = folder('', true, [folder('a', false)]);
    expect(immediateChildFolders(root, 'a')).toEqual([]);
  });

  it('returns [] for an anchor that is a file', () => {
    expect(immediateChildFolders(deepTree(), 'a/y.txt')).toEqual([]);
  });

  it('returns [] for an anchor that is not in the tree', () => {
    expect(immediateChildFolders(deepTree(), 'nowhere')).toEqual([]);
  });

  it('is pure — it does not mutate the tree it walked', () => {
    const root = deepTree();
    const before = JSON.stringify(root);
    immediateChildFolders(root, 'a');
    expect(JSON.stringify(root)).toBe(before);
  });
});

describe('the two together (C5)', () => {
  it('read the same ExpandNode view nextExpandTargets already reads', () => {
    // A compile-level guarantee, asserted here as a value-level one: the same
    // fixture object serves both functions with no adaptation.
    const root: ExpandNode = deepTree();
    expect(() => descendantOpenFolders(root, 'a')).not.toThrow();
    expect(() => immediateChildFolders(root, 'a')).not.toThrow();
  });

  it('Collapse All Children then Expand All Children is a coherent pair on one anchor', () => {
    const root = deepTree();
    // Everything the collapse would close is strictly beneath the anchor…
    for (const rel of descendantOpenFolders(root, 'a')) {
      expect(rel.startsWith('a/')).toBe(true);
    }
    // …and everything the expand would open is exactly one level down.
    for (const rel of immediateChildFolders(root, 'a')) {
      expect(rel.split('/')).toHaveLength(2);
    }
  });
});
