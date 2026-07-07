import { describe, it, expect } from 'vitest';
import { nextExpandTargets, type ExpandNode } from '@throng/core';

// Helpers to build a small open/closed tree.
const file = (relPath: string): ExpandNode => ({ relPath, kind: 'file', open: false });
const folder = (relPath: string, open: boolean, children?: ExpandNode[]): ExpandNode => ({
  relPath,
  kind: 'folder',
  open,
  children: open ? (children ?? []) : undefined,
});

describe('explorer level-by-level expand (004 expand.ts)', () => {
  it('first click from the root opens the first level of folders', () => {
    const root = folder('', true, [folder('a', false), folder('b', false), file('x.txt')]);
    expect(nextExpandTargets(root, '').sort()).toEqual(['a', 'b']);
  });

  it('second click opens the next level inside the now-open folders', () => {
    const root = folder('', true, [
      folder('a', true, [folder('a/c', false), file('a/y.txt')]),
      folder('b', true, [folder('b/d', false)]),
    ]);
    expect(nextExpandTargets(root, '').sort()).toEqual(['a/c', 'b/d']);
  });

  it('opens the shallowest collapsed ring first (mixed depths)', () => {
    const root = folder('', true, [
      folder('a', true, [folder('a/c', false)]), // grandchild closed (deeper)
      folder('b', false), // child closed (shallower) — wins
    ]);
    expect(nextExpandTargets(root, '')).toEqual(['b']);
  });

  it('returns nothing when everything reachable is already open', () => {
    const root = folder('', true, [folder('a', true, [file('a/x.txt')])]);
    expect(nextExpandTargets(root, '')).toEqual([]);
  });

  it('is context-sensitive: a collapsed selected folder opens itself', () => {
    const root = folder('', true, [folder('a', false), folder('b', false)]);
    expect(nextExpandTargets(root, 'a')).toEqual(['a']);
  });

  it('is context-sensitive: an open selected folder opens its children only', () => {
    const root = folder('', true, [
      folder('a', true, [folder('a/c', false), folder('a/d', false)]),
      folder('b', false), // sibling stays untouched
    ]);
    expect(nextExpandTargets(root, 'a').sort()).toEqual(['a/c', 'a/d']);
  });

  it('treats the root as a selectable, always-open anchor', () => {
    const root = folder('', true, [folder('a', false)]);
    expect(nextExpandTargets(root, '')).toEqual(['a']);
  });
});
