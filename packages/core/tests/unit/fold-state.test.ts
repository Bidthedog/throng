import { describe, it, expect } from 'vitest';
import {
  collapseAll,
  expandAll,
  initialFold,
  isCollapsed,
  prune,
  revealing,
  setSection,
  toggleAll,
  toggleSection,
  visibleSections,
} from '../../src/outline/fold-state.js';
import { buildSymbolTree } from '../../src/outline/document-symbol.js';
import type { HeadingRecord } from '../../src/outline/document-symbol.js';

/**
 * 047 T008 — the fold-state reducer (data-model.md "FoldState", research R3). One value per document
 * or standalone preview, relayed to every view: `base` sets the default, `flipped` lists the slugs
 * that differ from it. Every operation is pure.
 */

describe('initialFold', () => {
  it('seeds base from the preference with no flipped slugs', () => {
    expect(initialFold('expanded')).toEqual({ base: 'expanded', flipped: [] });
    expect(initialFold('collapsed')).toEqual({ base: 'collapsed', flipped: [] });
  });
});

describe('isCollapsed', () => {
  it('a slug is collapsed when it matches base xor is flipped', () => {
    expect(isCollapsed({ base: 'expanded', flipped: [] }, 'a')).toBe(false);
    expect(isCollapsed({ base: 'collapsed', flipped: [] }, 'a')).toBe(true);
    expect(isCollapsed({ base: 'expanded', flipped: ['a'] }, 'a')).toBe(true);
    expect(isCollapsed({ base: 'collapsed', flipped: ['a'] }, 'a')).toBe(false);
    // a flipped entry for another slug leaves this one unaffected
    expect(isCollapsed({ base: 'expanded', flipped: ['b'] }, 'a')).toBe(false);
  });
});

describe('setSection / toggleSection — other slugs untouched (FR-030a)', () => {
  it('adds a flipped entry so the target slug becomes collapsed, leaving others alone', () => {
    const s0 = initialFold('expanded');
    const s1 = setSection(s0, 'b', true);
    expect(isCollapsed(s1, 'b')).toBe(true);
    expect(isCollapsed(s1, 'a')).toBe(false);
    expect(isCollapsed(s1, 'c')).toBe(false);
  });

  it('removes a flipped entry when the requested state already equals base', () => {
    const s0 = { base: 'expanded' as const, flipped: ['a', 'b'] };
    const s1 = setSection(s0, 'a', false);
    expect(s1.flipped).toEqual(['b']);
  });

  it('is idempotent: setting a slug to its current state is a no-op', () => {
    const s0 = { base: 'expanded' as const, flipped: ['b'] };
    const s1 = setSection(s0, 'b', true);
    expect(s1).toEqual(s0);
  });

  it('toggleSection flips whatever the current state is', () => {
    const s0 = initialFold('expanded');
    const s1 = toggleSection(s0, 'a');
    expect(isCollapsed(s1, 'a')).toBe(true);
    const s2 = toggleSection(s1, 'a');
    expect(isCollapsed(s2, 'a')).toBe(false);
  });
});

describe('collapseAll / expandAll — reset flipped (FR-037a)', () => {
  it('collapseAll sets base to collapsed and clears flipped', () => {
    const s0 = { base: 'expanded' as const, flipped: ['a', 'b'] };
    expect(collapseAll(s0)).toEqual({ base: 'collapsed', flipped: [] });
  });

  it('expandAll sets base to expanded and clears flipped', () => {
    const s0 = { base: 'collapsed' as const, flipped: ['a', 'b'] };
    expect(expandAll(s0)).toEqual({ base: 'expanded', flipped: [] });
  });
});

describe('toggleAll', () => {
  it('collapses everything when any of the given slugs is expanded', () => {
    const s0 = { base: 'expanded' as const, flipped: ['a'] }; // a collapsed, b expanded
    expect(toggleAll(s0, ['a', 'b'])).toEqual({ base: 'collapsed', flipped: [] });
  });

  it('expands everything when every given slug is already collapsed', () => {
    const s0 = { base: 'collapsed' as const, flipped: [] };
    expect(toggleAll(s0, ['a', 'b'])).toEqual({ base: 'expanded', flipped: [] });
  });

  it('an empty slug list expands (vacuously, none is expanded)', () => {
    const s0 = { base: 'collapsed' as const, flipped: [] };
    expect(toggleAll(s0, [])).toEqual({ base: 'expanded', flipped: [] });
  });
});

describe('prune', () => {
  it('drops flipped entries for slugs no longer present', () => {
    const s0 = { base: 'expanded' as const, flipped: ['a', 'b', 'c'] };
    expect(prune(s0, ['a', 'c'])).toEqual({ base: 'expanded', flipped: ['a', 'c'] });
  });

  it('is a no-op when every flipped slug is still present', () => {
    const s0 = { base: 'expanded' as const, flipped: ['a', 'b'] };
    expect(prune(s0, ['a', 'b', 'z'])).toEqual(s0);
  });
});

const records: HeadingRecord[] = [
  { level: 1, text: 'A', slug: 'a', line: 0 },
  { level: 2, text: 'A.1', slug: 'a-1', line: 1 },
  { level: 3, text: 'A.1.i', slug: 'a-1-i', line: 2 },
  { level: 1, text: 'B', slug: 'b', line: 3 },
];
const tree = buildSymbolTree(records);

describe('revealing — expands a section and its ancestors (FR-040)', () => {
  it('expands the target slug and every ancestor, leaving unrelated slugs alone', () => {
    const s0 = collapseAll(initialFold('expanded'));
    const s1 = revealing(s0, tree, 'a-1-i');
    expect(isCollapsed(s1, 'a')).toBe(false);
    expect(isCollapsed(s1, 'a-1')).toBe(false);
    expect(isCollapsed(s1, 'a-1-i')).toBe(false);
    expect(isCollapsed(s1, 'b')).toBe(true);
  });

  it('revealing a top-level slug with no ancestors only expands itself', () => {
    const s0 = collapseAll(initialFold('expanded'));
    const s1 = revealing(s0, tree, 'b');
    expect(isCollapsed(s1, 'b')).toBe(false);
    expect(isCollapsed(s1, 'a')).toBe(true);
  });
});

describe('visibleSections — a collapsed ancestor hides descendants', () => {
  it('everything is visible when nothing is collapsed', () => {
    const s0 = initialFold('expanded');
    expect(visibleSections(s0, tree)).toEqual(new Set(['a', 'a-1', 'a-1-i', 'b']));
  });

  it('collapsing a parent hides its descendants but not itself or siblings', () => {
    const s0 = setSection(initialFold('expanded'), 'a-1', true);
    const visible = visibleSections(s0, tree);
    expect(visible.has('a')).toBe(true);
    expect(visible.has('a-1')).toBe(true);
    expect(visible.has('a-1-i')).toBe(false);
    expect(visible.has('b')).toBe(true);
  });

  it('re-expanding restores the descendants', () => {
    const collapsed = setSection(initialFold('expanded'), 'a-1', true);
    const reexpanded = setSection(collapsed, 'a-1', false);
    expect(visibleSections(reexpanded, tree)).toEqual(new Set(['a', 'a-1', 'a-1-i', 'b']));
  });

  it('collapsing the root hides every descendant', () => {
    const s0 = setSection(initialFold('expanded'), 'a', true);
    const visible = visibleSections(s0, tree);
    expect(visible.has('a')).toBe(true);
    expect(visible.has('a-1')).toBe(false);
    expect(visible.has('a-1-i')).toBe(false);
    expect(visible.has('b')).toBe(true);
  });
});

describe('flipped is always sorted and unique', () => {
  it('setSection keeps flipped sorted after several insertions in any order', () => {
    let s = initialFold('expanded');
    s = setSection(s, 'c', true);
    s = setSection(s, 'a', true);
    s = setSection(s, 'b', true);
    expect(s.flipped).toEqual(['a', 'b', 'c']);
  });

  it('two states reaching the same set of flipped slugs compare equal (no duplicate insert)', () => {
    let s = initialFold('expanded');
    s = setSection(s, 'a', true);
    s = setSection(s, 'a', true); // already collapsed — no duplicate
    expect(s.flipped).toEqual(['a']);
  });
});
