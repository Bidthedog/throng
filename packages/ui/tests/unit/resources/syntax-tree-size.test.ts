import { describe, it, expect } from 'vitest';
import { sampleSyntaxTree, type SizedTree } from '../../../src/renderer/resources/syntax-tree-size.js';

/** A buffer of `nodes` nodes (four 16-bit words each) spanning `length` characters. */
const buf = (nodes: number, length: number) => ({ buffer: new Uint16Array(nodes * 4), length });

/** A tree whose children sit end to end. */
function tree(children: SizedTree['children']): SizedTree {
  const positions: number[] = [];
  let at = 0;
  for (const c of children) {
    positions.push(at);
    at += c.length;
  }
  return { children, positions, length: at };
}

describe('syntax tree size (055 FR-024, research R9)', () => {
  it('counts every node: each tree, and each buffer as its length / 4', () => {
    const t = tree([buf(10, 100), tree([buf(5, 50), buf(5, 50)]), buf(3, 30)]);
    expect(sampleSyntaxTree(t)).toEqual({ nodes: 1 + 10 + (1 + 5 + 5) + 3, trees: 2, chars: 230 });
  });

  it('stops at its budget, and says how far into the document the count reached', () => {
    const t = tree(Array.from({ length: 100 }, () => tree([buf(9, 10)])));
    // Each child is 10 nodes over 10 characters; a budget of 95 stops after the ninth or tenth child.
    const s = sampleSyntaxTree(t, 95);
    expect(s.chars).toBeGreaterThan(0);
    expect(s.chars).toBeLessThan(t.length);
    expect(s.nodes / s.chars).toBeCloseTo(1, 1);
  });

  it('counts a tree once: the same tree is answered from the cache', () => {
    const t = tree([buf(4, 8)]);
    const first = sampleSyntaxTree(t);
    (t.children as unknown[]).push(buf(100, 100)); // a tree never changes; this proves the second call did not walk
    expect(sampleSyntaxTree(t)).toBe(first);
  });
});
