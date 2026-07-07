import { describe, it, expect } from 'vitest';
import {
  createDefaultLayout,
  addTab,
  addPanel,
  movePanelToEdge,
  addTabFromPanel,
  countPanels,
  collectPanels,
  isMainLayoutValid,
  type WorkspaceLayout,
} from '@throng/core';

function base(): WorkspaceLayout {
  return createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
}

function allPanelIds(layout: WorkspaceLayout): string[] {
  return layout.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id)).sort();
}

describe('addTabFromPanel (FR-027 — drag a panel onto "+" → new solo tab)', () => {
  it('moves a panel out of its tab into a new active tab containing only that panel', () => {
    // Two panels in t1 (p1,p2). Move p2 into its own new tab.
    let l = addPanel(base(), 't1', 'p2');
    l = addTabFromPanel(l, 'p2', { tab: 't2' });

    expect(l.activeTabId).toBe('t2');
    const t2 = l.tabs.find((t) => t.id === 't2')!;
    expect(countPanels(t2.root)).toBe(1);
    expect(collectPanels(t2.root)[0].id).toBe('p2');

    // p1 stays behind in t1; nothing lost or duplicated.
    const t1 = l.tabs.find((t) => t.id === 't1')!;
    expect(collectPanels(t1.root).map((p) => p.id)).toEqual(['p1']);
    expect(allPanelIds(l)).toEqual(['p1', 'p2']);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('collapses the emptied source split slot when moving out of a deep split', () => {
    // t1 holds a 3-way row split p1,p2,p3. Move p2 out.
    let l = addPanel(base(), 't1', 'p2');
    l = addPanel(l, 't1', 'p3');
    l = addTabFromPanel(l, 'p2', { tab: 't2' });

    const t1 = l.tabs.find((t) => t.id === 't1')!;
    expect(collectPanels(t1.root).map((p) => p.id).sort()).toEqual(['p1', 'p3']);
    expect(countPanels(t1.root)).toBe(2);
    expect(allPanelIds(l)).toEqual(['p1', 'p2', 'p3']);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('prunes an emptied source tab when the moved panel was its only panel', () => {
    // p1 in t1, p2 alone in t2. Move p2 → t3 (t2 becomes empty → pruned).
    let l = addTab(base(), { tab: 't2', panel: 'p2' });
    l = addTabFromPanel(l, 'p2', { tab: 't3' });

    expect(l.tabs.find((t) => t.id === 't2')).toBeUndefined();
    const t3 = l.tabs.find((t) => t.id === 't3')!;
    expect(collectPanels(t3.root).map((p) => p.id)).toEqual(['p2']);
    expect(l.activeTabId).toBe('t3');
    expect(allPanelIds(l)).toEqual(['p1', 'p2']);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('honours the never-empty guard: the sole panel of the workspace is not moved out', () => {
    const l = base(); // single panel p1
    expect(addTabFromPanel(l, 'p1', { tab: 't2' })).toEqual(l);
  });

  it('is a no-op for an unknown panel id', () => {
    let l = addPanel(base(), 't1', 'p2');
    l = movePanelToEdge(l, 'p2', 'p1', 'right'); // normalise into a split
    expect(addTabFromPanel(l, 'nope', { tab: 't2' })).toEqual(l);
  });
});
