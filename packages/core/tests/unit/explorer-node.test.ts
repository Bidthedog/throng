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

  it('joinRel and parentRel are inverse-ish helpers', () => {
    expect(joinRel('', 'a')).toBe('a');
    expect(joinRel('a/b', 'c')).toBe('a/b/c');
    expect(parentRel('a/b/c')).toBe('a/b');
    expect(parentRel('top')).toBe('');
  });
});
