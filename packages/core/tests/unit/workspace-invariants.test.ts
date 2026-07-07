import { describe, it, expect } from 'vitest';
import {
  countPanels,
  collectPanels,
  validateMainLayout,
  isMainLayoutValid,
  createDefaultLayout,
  type WorkspaceLayout,
  type Tab,
  type Panel,
  type SplitNode,
} from '@throng/core';

const panel = (id: string, originProjectId = 'proj'): Panel => ({
  type: 'panel',
  id,
  originProjectId,
  title: id,
});

const split = (orientation: 'row' | 'column', children: (SplitNode | Panel)[], sizes?: number[]): SplitNode => ({
  type: 'split',
  orientation,
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});

const layout = (tabs: Tab[], activeTabId?: string): WorkspaceLayout => ({
  projectId: 'proj',
  schemaVersion: 1,
  tabs,
  activeTabId: activeTabId ?? tabs[0]?.id ?? 't0',
});

describe('panel counting', () => {
  it('counts a single leaf panel', () => {
    expect(countPanels(panel('a'))).toBe(1);
  });

  it('counts panels across a nested split tree', () => {
    const tree = split('row', [panel('a'), split('column', [panel('b'), panel('c')])]);
    expect(countPanels(tree)).toBe(3);
    expect(collectPanels(tree).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('createDefaultLayout (INV-1/2)', () => {
  it('produces one Tab with exactly one placeholder Panel, active', () => {
    const l = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    expect(l.tabs).toHaveLength(1);
    expect(countPanels(l.tabs[0].root)).toBe(1);
    expect(l.activeTabId).toBe('t1');
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('tags the panel with the owning project (INV-4)', () => {
    const l = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    expect(collectPanels(l.tabs[0].root)[0].originProjectId).toBe('proj');
  });
});

describe('validateMainLayout', () => {
  it('passes a well-formed layout', () => {
    const l = layout([{ id: 't1', title: 'Tab 1', root: panel('a') }]);
    expect(validateMainLayout(l)).toEqual([]);
  });

  it('flags a layout with no tabs (INV-2)', () => {
    const l = layout([]);
    expect(validateMainLayout(l).length).toBeGreaterThan(0);
  });

  it('flags an activeTabId that does not reference a tab (INV-7)', () => {
    const l = layout([{ id: 't1', title: 'Tab 1', root: panel('a') }], 'missing');
    expect(validateMainLayout(l).length).toBeGreaterThan(0);
  });

  it('flags a SplitNode with fewer than two children (INV-3/7)', () => {
    const bad = split('row', [panel('a')], [1]);
    const l = layout([{ id: 't1', title: 'Tab 1', root: bad }]);
    expect(validateMainLayout(l).length).toBeGreaterThan(0);
  });

  it('flags sizes whose length does not match children (INV-7)', () => {
    const bad: SplitNode = { type: 'split', orientation: 'row', children: [panel('a'), panel('b')], sizes: [1] };
    const l = layout([{ id: 't1', title: 'Tab 1', root: bad }]);
    expect(validateMainLayout(l).length).toBeGreaterThan(0);
  });

  it('flags a cross-project panel in the main layout (INV-4)', () => {
    const l = layout([{ id: 't1', title: 'Tab 1', root: panel('a', 'other-project') }]);
    const violations = validateMainLayout(l);
    expect(violations.length).toBeGreaterThan(0);
    expect(isMainLayoutValid(l)).toBe(false);
  });
});
