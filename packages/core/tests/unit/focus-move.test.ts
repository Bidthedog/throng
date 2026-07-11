import { describe, it, expect } from 'vitest';
import {
  panelRects,
  moveFocus,
  cycleOrder,
  nextInCycle,
  type LayoutNode,
} from '@throng/core';

// 012 US3 (FR-015, contracts/focus-move.md): pure split-tree geometry for
// directional + cyclic keyboard focus movement. DOM-free, deterministic.

function panel(id: string): LayoutNode {
  return { type: 'panel', id, originProjectId: 'proj', title: id };
}
function split(orientation: 'row' | 'column', children: LayoutNode[], sizes?: number[]): LayoutNode {
  return { type: 'split', orientation, children, sizes: sizes ?? children.map(() => 1 / children.length) };
}

describe('panelRects', () => {
  it('gives a single panel the whole unit square', () => {
    const rects = panelRects(panel('a'));
    expect(rects.get('a')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('divides a 2-column row split along x by its sizes', () => {
    const root = split('row', [panel('l'), panel('r')], [0.5, 0.5]);
    const rects = panelRects(root);
    expect(rects.get('l')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(rects.get('r')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it('divides a column split along y', () => {
    const root = split('column', [panel('t'), panel('b')], [0.5, 0.5]);
    const rects = panelRects(root);
    expect(rects.get('t')).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(rects.get('b')).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe('moveFocus', () => {
  const twoCol = split('row', [panel('l'), panel('r')], [0.5, 0.5]);

  it('moves to the directional neighbour in a 2-column split', () => {
    expect(moveFocus(twoCol, 'l', 'right')).toBe('r');
    expect(moveFocus(twoCol, 'r', 'left')).toBe('l');
  });

  it('stays put at the layout edge — returns null, no wrap (FR-015)', () => {
    expect(moveFocus(twoCol, 'r', 'right')).toBeNull();
    expect(moveFocus(twoCol, 'l', 'left')).toBeNull();
    expect(moveFocus(twoCol, 'l', 'up')).toBeNull();
    expect(moveFocus(twoCol, 'l', 'down')).toBeNull();
  });

  it('selects the neighbour that overlaps the active on the perpendicular axis', () => {
    // row( A , column(B top, C bottom) ). A spans the full height; a move right from
    // A must land on whichever of B/C overlaps A's vertical band — both do, so it
    // picks the nearest; a move right from the *bottom half* would prefer C.
    const root = split('row', [panel('a'), split('column', [panel('b'), panel('c')], [0.5, 0.5])], [0.5, 0.5]);
    // From B (top-right), left → A (the only panel to the left overlapping B's band).
    expect(moveFocus(root, 'b', 'left')).toBe('a');
    expect(moveFocus(root, 'c', 'left')).toBe('a');
    // From A, right → B or C (both overlap); it must be one of them, not null.
    expect(['b', 'c']).toContain(moveFocus(root, 'a', 'right'));
    // Within the right column, up/down move between B and C.
    expect(moveFocus(root, 'b', 'down')).toBe('c');
    expect(moveFocus(root, 'c', 'up')).toBe('b');
    expect(moveFocus(root, 'b', 'up')).toBeNull();
  });
});

describe('cycleOrder / nextInCycle', () => {
  const root = split('row', [panel('a'), split('column', [panel('b'), panel('c')], [0.5, 0.5])], [0.5, 0.5]);

  it('is a stable depth-first layout order, independent of focus history', () => {
    expect(cycleOrder(root)).toEqual(['a', 'b', 'c']);
  });

  it('wraps forward and backward through the ring', () => {
    const order = cycleOrder(root);
    expect(nextInCycle(order, 'a', 1)).toBe('b');
    expect(nextInCycle(order, 'c', 1)).toBe('a'); // wrap forward
    expect(nextInCycle(order, 'a', -1)).toBe('c'); // wrap backward
    expect(nextInCycle(order, 'b', -1)).toBe('a');
  });

  it('forward then the same count backward returns to the start (SC-008a)', () => {
    const order = cycleOrder(root);
    let id = 'a';
    for (let i = 0; i < 5; i += 1) id = nextInCycle(order, id, 1);
    for (let i = 0; i < 5; i += 1) id = nextInCycle(order, id, -1);
    expect(id).toBe('a');
  });
});
