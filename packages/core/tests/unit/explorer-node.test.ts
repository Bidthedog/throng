import { describe, it, expect } from 'vitest';
import { toNodes, sortNodes, joinRel, parentRel, type FileNode } from '@throng/core';
import type { DirEntry } from '@throng/core';

const f = (name: string, kind: 'file' | 'folder', extra: Partial<DirEntry> = {}): DirEntry => ({
  name,
  kind,
  isSymlink: false,
  ...extra,
});

describe('explorer node mapping + sort (004 T017/T020)', () => {
  it('maps entries to root-relative nodes', () => {
    const nodes = toNodes([f('a.txt', 'file'), f('sub', 'folder', { hasChildren: true })], '');
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
    expect(byName['a.txt'].relPath).toBe('a.txt');
    expect(byName['a.txt'].id).toBe('a.txt');
    expect(byName['sub'].relPath).toBe('sub');
    expect(byName['sub'].hasChildren).toBe(true);
    expect(byName['a.txt'].hasChildren).toBe(false);
  });

  it('nests relPath under a parent', () => {
    const nodes = toNodes([f('leaf.ts', 'file')], 'src/app');
    expect(nodes[0].relPath).toBe('src/app/leaf.ts');
  });

  it('sorts folders before files, then case-insensitive A–Z', () => {
    const nodes = sortNodes([
      { id: 'b.txt', name: 'b.txt', kind: 'file', relPath: 'b.txt', isSymlink: false, hasChildren: false },
      { id: 'Zed', name: 'Zed', kind: 'folder', relPath: 'Zed', isSymlink: false, hasChildren: false },
      { id: 'a.txt', name: 'a.txt', kind: 'file', relPath: 'a.txt', isSymlink: false, hasChildren: false },
      { id: 'apple', name: 'apple', kind: 'folder', relPath: 'apple', isSymlink: false, hasChildren: false },
    ] as FileNode[]);
    expect(nodes.map((n) => n.name)).toEqual(['apple', 'Zed', 'a.txt', 'b.txt']);
  });

  const files = (...names: string[]): FileNode[] =>
    names.map((name) => ({ id: name, name, kind: 'file', relPath: name, isSymlink: false, hasChildren: false }));
  const NUMBERED = ['test 10.md', 'test 2.md', 'test 1.md', 'test 25.md', 'test 11.md', 'test 3.md', 'test 20.md', 'test 9.md'];

  it('orders numbers in names by value by default (#470, 004 FR-036a)', () => {
    expect(sortNodes(files(...NUMBERED)).map((n) => n.name)).toEqual([
      'test 1.md',
      'test 2.md',
      'test 3.md',
      'test 9.md',
      'test 10.md',
      'test 11.md',
      'test 20.md',
      'test 25.md',
    ]);
    expect(sortNodes(files('v10-final', 'v2-final')).map((n) => n.name)).toEqual(['v2-final', 'v10-final']);
  });

  it('orders character by character when asked, exactly as before #470', () => {
    expect(sortNodes(files(...NUMBERED), 'characters').map((n) => n.name)).toEqual([
      'test 1.md',
      'test 10.md',
      'test 11.md',
      'test 2.md',
      'test 20.md',
      'test 25.md',
      'test 3.md',
      'test 9.md',
    ]);
  });

  it('keeps folders first and case-insensitive A–Z in both orders', () => {
    const mixed = [
      ...files('b.txt', 'a.txt'),
      { id: 'Zed', name: 'Zed', kind: 'folder', relPath: 'Zed', isSymlink: false, hasChildren: false },
      { id: 'apple', name: 'apple', kind: 'folder', relPath: 'apple', isSymlink: false, hasChildren: false },
    ] as FileNode[];
    for (const order of ['natural', 'characters'] as const) {
      expect(sortNodes(mixed, order).map((n) => n.name)).toEqual(['apple', 'Zed', 'a.txt', 'b.txt']);
    }
  });

  it('toNodes sorts by the order it is given', () => {
    const entries = [f('item 10', 'file'), f('item 2', 'file')];
    expect(toNodes(entries, '').map((n) => n.name)).toEqual(['item 2', 'item 10']);
    expect(toNodes(entries, '', 'characters').map((n) => n.name)).toEqual(['item 10', 'item 2']);
  });

  it('joinRel and parentRel are inverse-ish helpers', () => {
    expect(joinRel('', 'a')).toBe('a');
    expect(joinRel('a/b', 'c')).toBe('a/b/c');
    expect(parentRel('a/b/c')).toBe('a/b');
    expect(parentRel('top')).toBe('');
  });
});
