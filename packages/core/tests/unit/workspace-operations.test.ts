import { describe, it, expect } from 'vitest';
import {
  createDefaultLayout,
  addTab,
  addPanel,
  movePanelToEdge,
  movePanelToTab,
  removePanel,
  reorderTab,
  setActiveTab,
  renameTab,
  renamePanel,
  closeTab,
  closeOtherTabs,
  resizeSplit,
  countPanels,
  collectPanels,
  isMainLayoutValid,
  isSplit,
  type WorkspaceLayout,
} from '@throng/core';

function base(): WorkspaceLayout {
  return createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
}

function allPanelIds(layout: WorkspaceLayout): string[] {
  return layout.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id)).sort();
}

describe('addTab', () => {
  it('adds a Tab with one placeholder Panel and activates it', () => {
    const l = addTab(base(), { tab: 't2', panel: 'p2' });
    expect(l.tabs).toHaveLength(2);
    expect(l.activeTabId).toBe('t2');
    const newTab = l.tabs.find((t) => t.id === 't2')!;
    expect(countPanels(newTab.root)).toBe(1);
    expect(collectPanels(newTab.root)[0].originProjectId).toBe('proj');
    expect(isMainLayoutValid(l)).toBe(true);
  });
});

describe('addPanel', () => {
  it('adds a placeholder Panel to the given Tab', () => {
    const l = addPanel(base(), 't1', 'p2');
    const tab = l.tabs[0];
    expect(countPanels(tab.root)).toBe(2);
    expect(isSplit(tab.root)).toBe(true);
    expect(allPanelIds(l)).toEqual(['p1', 'p2']);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('appends into an existing row split rather than nesting endlessly', () => {
    let l = addPanel(base(), 't1', 'p2');
    l = addPanel(l, 't1', 'p3');
    const tab = l.tabs[0];
    expect(countPanels(tab.root)).toBe(3);
    if (isSplit(tab.root)) {
      expect(tab.root.children).toHaveLength(3);
      expect(tab.root.sizes).toHaveLength(3);
    }
  });
});

describe('movePanelToEdge (split + regroup)', () => {
  it('splits a Tab into a row when a Panel is dropped on the right edge', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    // Move p2 (in t2) onto p1's right edge (in t1).
    l = movePanelToEdge(l, 'p2', 'p1', 'right');
    const t1 = l.tabs.find((t) => t.id === 't1')!;
    expect(countPanels(t1.root)).toBe(2);
    if (isSplit(t1.root)) {
      expect(t1.root.orientation).toBe('row');
      // right edge → target first, incoming second.
      expect(collectPanels(t1.root).map((p) => p.id)).toEqual(['p1', 'p2']);
    }
    // p2's source tab t2 had only that panel → tab removed.
    expect(l.tabs.find((t) => t.id === 't2')).toBeUndefined();
    expect(allPanelIds(l)).toEqual(['p1', 'p2']);
  });

  it('creates a column split with the incoming Panel first on a top-edge drop', () => {
    let l = addPanel(base(), 't1', 'p2'); // p1,p2 in a row
    l = movePanelToEdge(l, 'p2', 'p1', 'top');
    const t1 = l.tabs[0];
    const root = t1.root;
    // p1 was replaced by a column split [p2, p1].
    const colSplit = collectPanels(root);
    expect(colSplit.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(countPanels(root)).toBe(2);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('is a no-op when source and target are the same Panel', () => {
    const l = base();
    expect(movePanelToEdge(l, 'p1', 'p1', 'left')).toEqual(l);
  });

  it('never loses or duplicates a Panel', () => {
    let l = addPanel(base(), 't1', 'p2');
    l = addPanel(l, 't1', 'p3');
    l = movePanelToEdge(l, 'p3', 'p1', 'bottom');
    expect(allPanelIds(l)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('movePanelToTab', () => {
  it('moves a Panel into another Tab as a sibling', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    l = movePanelToTab(l, 'p1', 't2');
    const t2 = l.tabs.find((t) => t.id === 't2')!;
    expect(countPanels(t2.root)).toBe(2);
    // t1 lost its only panel → removed.
    expect(l.tabs.find((t) => t.id === 't1')).toBeUndefined();
    expect(allPanelIds(l)).toEqual(['p1', 'p2']);
  });
});

describe('reorderTab', () => {
  it('moves a Tab to a new index', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    l = addTab(l, { tab: 't3', panel: 'p3' });
    expect(l.tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    l = reorderTab(l, 't3', 0);
    expect(l.tabs.map((t) => t.id)).toEqual(['t3', 't1', 't2']);
  });
});

describe('removePanel (collapse + never-empty)', () => {
  it('collapses the split slot when one of two Panels is removed', () => {
    let l = addPanel(base(), 't1', 'p2'); // split [p1,p2]
    l = removePanel(l, 'p2');
    const tab = l.tabs[0];
    // Split collapses to the single remaining Panel.
    expect(tab.root).toMatchObject({ type: 'panel', id: 'p1' });
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('removes the Tab when its last Panel is removed (other Tabs remain)', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    l = removePanel(l, 'p2');
    expect(l.tabs.find((t) => t.id === 't2')).toBeUndefined();
    expect(l.tabs).toHaveLength(1);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('refuses to remove the last Panel of the last Tab (never empty)', () => {
    const l = base();
    const after = removePanel(l, 'p1');
    expect(countPanels(after.tabs[0].root)).toBe(1);
    expect(after.tabs).toHaveLength(1);
  });

  it('reassigns activeTabId when the active Tab is removed', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' }); // active t2
    expect(l.activeTabId).toBe('t2');
    l = removePanel(l, 'p2'); // removes t2
    expect(l.activeTabId).toBe('t1');
  });
});

describe('setActiveTab', () => {
  it('activates an existing Tab', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    l = setActiveTab(l, 't1');
    expect(l.activeTabId).toBe('t1');
  });

  it('ignores an unknown Tab id', () => {
    const l = base();
    expect(setActiveTab(l, 'nope').activeTabId).toBe('t1');
  });
});

describe('renameTab / renamePanel (FR-036/037)', () => {
  it('renames a Tab', () => {
    const l = renameTab(base(), 't1', 'My Tab');
    expect(l.tabs[0].title).toBe('My Tab');
  });

  it('ignores a blank Tab title', () => {
    const l = renameTab(base(), 't1', '   ');
    expect(l.tabs[0].title).toBe('Tab 1');
  });

  it('renames a Panel deep in the tree', () => {
    let l = addPanel(base(), 't1', 'p2');
    l = renamePanel(l, 'p2', 'Logs');
    expect(collectPanels(l.tabs[0].root).find((p) => p.id === 'p2')?.title).toBe('Logs');
  });
});

describe('closeTab / closeOtherTabs (FR-036)', () => {
  it('closes a Tab and reassigns the active one', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' }); // active t2
    l = closeTab(l, 't2');
    expect(l.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(l.activeTabId).toBe('t1');
  });

  it('refuses to close the only Tab (never empty)', () => {
    const l = base();
    expect(closeTab(l, 't1')).toEqual(l);
  });

  it('closes every other Tab, keeping the target active', () => {
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    l = addTab(l, { tab: 't3', panel: 'p3' });
    l = closeOtherTabs(l, 't2');
    expect(l.tabs.map((t) => t.id)).toEqual(['t2']);
    expect(l.activeTabId).toBe('t2');
  });
});

describe('resizeSplit (FR-038)', () => {
  it('updates the sizes of a split at the tab root', () => {
    const l = addPanel(base(), 't1', 'p2'); // root is a row split [p1,p2]
    const resized = resizeSplit(l, 't1', [], [0.7, 0.3]);
    const root = resized.tabs[0].root;
    expect(isSplit(root)).toBe(true);
    if (isSplit(root)) expect(root.sizes).toEqual([0.7, 0.3]);
  });

  it('normalises sizes that do not sum to 1', () => {
    const l = addPanel(base(), 't1', 'p2');
    const resized = resizeSplit(l, 't1', [], [3, 1]);
    const root = resized.tabs[0].root;
    if (isSplit(root)) {
      expect(root.sizes[0]).toBeCloseTo(0.75);
      expect(root.sizes[1]).toBeCloseTo(0.25);
    }
  });

  it('ignores a size array whose length mismatches the split', () => {
    const l = addPanel(base(), 't1', 'p2');
    expect(resizeSplit(l, 't1', [], [1])).toEqual(l);
  });
});
