import { describe, it, expect } from 'vitest';
import {
  createDefaultLayout,
  addTab,
  addPanel,
  detachPanel,
  detachTab,
  addTabToSubWorkspace,
  addPanelToSubWorkspace,
  nextSubWorkspaceTabName,
  reattachPanel,
  canReattachPanel,
  validateSubWorkspace,
  countPanels,
  collectPanels,
  isMainLayoutValid,
  type SubWorkspace,
  type WorkspaceLayout,
  type Panel,
} from '@throng/core';

const BOUNDS = { x: 100, y: 100, width: 800, height: 600, displayId: 'd1' };

describe('nextSubWorkspaceTabName (003 — unique default Tab names)', () => {
  it('starts at "Sub-workspace Tab 1" when none exist', () => {
    expect(nextSubWorkspaceTabName([])).toBe('Sub-workspace Tab 1');
    expect(nextSubWorkspaceTabName([{ title: 'Build' }, { title: 'Logs' }])).toBe(
      'Sub-workspace Tab 1',
    );
  });

  it('is the highest existing index + 1 (ignores other titles)', () => {
    expect(
      nextSubWorkspaceTabName([
        { title: 'Sub-workspace Tab 1' },
        { title: 'Random' },
        { title: 'Sub-workspace Tab 3' },
      ]),
    ).toBe('Sub-workspace Tab 4');
  });
});

describe('sub-workspace Tabs get unique default names (003 / "via any method")', () => {
  const subWith = (titles: string[]): SubWorkspace => ({
    id: 'sw',
    ownerUser: 'u',
    name: 'SW',
    colour: '#8a8f98',
    bounds: BOUNDS,
    tabs: titles.map((title, i) => ({
      id: `st${i}`,
      title,
      root: { type: 'panel' as const, id: `seed${i}`, originProjectId: 'x', title },
    })),
  });

  it('detachPanel names the new sub-workspace’s first Tab "Sub-workspace Tab 1"', () => {
    const layout = addPanel(createDefaultLayout('proj', { tab: 't1', panel: 'p1' }), 't1', 'p2');
    const result = detachPanel(layout, 'p2', { subWorkspace: 'sw1', tab: 'st1' }, 'alice', BOUNDS);
    expect(result.subWorkspace!.tabs[0].title).toBe('Sub-workspace Tab 1');
  });

  it('addPanelToSubWorkspace (new Tab) gives a unique "Sub-workspace Tab N"', () => {
    const sub = subWith(['Sub-workspace Tab 1']);
    const panel: Panel = { type: 'panel', id: 'pNew', originProjectId: 'x', title: 'New' };
    const result = addPanelToSubWorkspace(sub, panel, { newTabId: 'nt' });
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1].title).toBe('Sub-workspace Tab 2');
  });

  it('two consecutive panel adds never collide on the name', () => {
    let sub = subWith([]);
    const p1: Panel = { type: 'panel', id: 'a', originProjectId: 'x', title: 'A' };
    const p2: Panel = { type: 'panel', id: 'b', originProjectId: 'x', title: 'B' };
    sub = addPanelToSubWorkspace(sub, p1, { newTabId: 'n1' });
    sub = addPanelToSubWorkspace(sub, p2, { newTabId: 'n2' });
    const titles = sub.tabs.map((t) => t.title);
    expect(titles).toContain('Sub-workspace Tab 1');
    expect(titles).toContain('Sub-workspace Tab 2');
    expect(new Set(titles).size).toBe(titles.length); // all unique
  });
});

function twoPanelLayout(): WorkspaceLayout {
  return addPanel(createDefaultLayout('proj', { tab: 't1', panel: 'p1' }), 't1', 'p2');
}

describe('detachPanel (US7 clone-and-sync)', () => {
  it('clones a Panel into a new sub-workspace, leaving the original in the project', () => {
    const layout = twoPanelLayout();
    const result = detachPanel(layout, 'p2', { subWorkspace: 'sw1', tab: 'st1' }, 'alice', BOUNDS);
    expect(result.subWorkspace).not.toBeNull();
    // main is UNCHANGED — the Panel stays in the project (clone, not move).
    expect(result.layout).toEqual(layout);
    expect(collectPanels(result.layout.tabs[0].root).map((p) => p.id)).toEqual(['p1', 'p2']);
    // sub holds a copy of p2 with the SAME identity (synced).
    expect(result.subWorkspace!.tabs).toHaveLength(1);
    expect(collectPanels(result.subWorkspace!.tabs[0].root).map((p) => p.id)).toEqual(['p2']);
    expect(result.subWorkspace!.bounds.displayId).toBe('d1');
    expect(isMainLayoutValid(result.layout)).toBe(true);
  });

  it('clones even the only Panel (the main project keeps it — never empties)', () => {
    const layout = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    const result = detachPanel(layout, 'p1', { subWorkspace: 'sw1', tab: 'st1' }, 'alice', BOUNDS);
    expect(result.subWorkspace).not.toBeNull();
    expect(result.layout).toEqual(layout); // main untouched
    expect(collectPanels(result.subWorkspace!.tabs[0].root).map((p) => p.id)).toEqual(['p1']);
  });

  it('refuses a Panel that does not exist', () => {
    const layout = twoPanelLayout();
    const result = detachPanel(layout, 'nope', { subWorkspace: 'sw1', tab: 'st1' }, 'alice', BOUNDS);
    expect(result.subWorkspace).toBeNull();
    expect(result.layout).toEqual(layout);
  });
});

describe('addTabToSubWorkspace omits Panels already present (003)', () => {
  const sub: SubWorkspace = {
    id: 'sw',
    ownerUser: 'u',
    name: 'SW',
    colour: '#8a8f98',
    bounds: BOUNDS,
    tabs: [{ id: 'st', title: 'A', root: { type: 'panel', id: 'pA', originProjectId: 'x', title: 'A' } }],
  };

  it('adds only the Panels not already in the sub-workspace', () => {
    // A Tab with pA (already present) + pB (new), split as a row.
    const tab = {
      id: 't',
      title: 'T',
      root: {
        type: 'split' as const,
        orientation: 'row' as const,
        children: [
          { type: 'panel' as const, id: 'pA', originProjectId: 'x', title: 'A' },
          { type: 'panel' as const, id: 'pB', originProjectId: 'x', title: 'B' },
        ],
        sizes: [0.5, 0.5],
      },
    };
    const result = addTabToSubWorkspace(sub, tab, 'newTab');
    expect(result.tabs).toHaveLength(2);
    // The new Tab holds only pB (pA was already present).
    expect(collectPanels(result.tabs[1].root).map((p) => p.id)).toEqual(['pB']);
  });

  it('creates no Tab when every Panel is already present', () => {
    const tab = { id: 't', title: 'T', root: { type: 'panel' as const, id: 'pA', originProjectId: 'x', title: 'A' } };
    const result = addTabToSubWorkspace(sub, tab, 'newTab');
    expect(result.tabs).toHaveLength(1); // unchanged — nothing new to add
    expect(result).toEqual(sub);
  });
});

describe('detachTab (US7 clone-and-sync)', () => {
  it('clones a whole Tab into a sub-workspace it owns, leaving the Tab in the main workspace', () => {
    const layout = addTab(createDefaultLayout('proj', { tab: 't1', panel: 'p1' }), {
      tab: 't2',
      panel: 'p2',
    });
    const result = detachTab(layout, 't2', { subWorkspace: 'sw1', tab: 'st2' }, 'alice', BOUNDS);
    expect(result.subWorkspace).not.toBeNull();
    // main keeps t2 (clone, not move).
    expect(result.layout).toEqual(layout);
    expect(result.layout.tabs.find((t) => t.id === 't2')).toBeDefined();
    // the sub-workspace owns a fresh Tab id but its Panels keep their identity.
    expect(result.subWorkspace!.tabs[0].id).toBe('st2');
    expect(collectPanels(result.subWorkspace!.tabs[0].root).map((p) => p.id)).toEqual(['p2']);
    expect(isMainLayoutValid(result.layout)).toBe(true);
  });

  it('clones even the only Tab (the main workspace keeps it)', () => {
    const layout = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    const result = detachTab(layout, 't1', { subWorkspace: 'sw1', tab: 'st1' }, 'alice', BOUNDS);
    expect(result.subWorkspace).not.toBeNull();
    expect(result.layout).toEqual(layout);
  });
});

describe('sub-workspace may mix projects (INV-5)', () => {
  it('validates a sub-workspace containing Panels from multiple projects', () => {
    const sub: SubWorkspace = {
      id: 'sw1',
      ownerUser: 'alice',
      bounds: BOUNDS,
      tabs: [
        {
          id: 'st1',
          title: 'Mixed',
          root: {
            type: 'split',
            orientation: 'row',
            children: [
              { type: 'panel', id: 'a', originProjectId: 'projA', title: 'A' },
              { type: 'panel', id: 'b', originProjectId: 'projB', title: 'B' },
            ],
            sizes: [0.5, 0.5],
          },
        },
      ],
    };
    expect(validateSubWorkspace(sub)).toEqual([]);
  });
});

describe('reattachPanel (INV-6 merge-to-origin)', () => {
  function subWith(panel: Panel): SubWorkspace {
    return { id: 'sw1', ownerUser: 'alice', bounds: BOUNDS, tabs: [{ id: 'st1', title: 'D', root: panel }] };
  }

  it('reattaches a Panel only into its origin project’s layout', () => {
    const layout = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    const sub = subWith({ type: 'panel', id: 'px', originProjectId: 'proj', title: 'PX' });
    expect(canReattachPanel({ type: 'panel', id: 'px', originProjectId: 'proj', title: 'PX' }, layout)).toBe(true);

    const result = reattachPanel(layout, sub, 'px', 'newtab');
    expect(result.reattached).toBe(true);
    // px is now in the main layout (a new Tab) and gone from the sub.
    expect(result.layout.tabs.some((t) => collectPanels(t.root).some((p) => p.id === 'px'))).toBe(true);
    const subPanelCount = result.subWorkspace.tabs.reduce((n, t) => n + countPanels(t.root), 0);
    expect(subPanelCount).toBe(0);
    expect(isMainLayoutValid(result.layout)).toBe(true);
  });

  it('refuses to reattach a Panel from a different project (INV-4 stays intact)', () => {
    const layout = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    const sub = subWith({ type: 'panel', id: 'foreign', originProjectId: 'other', title: 'F' });
    expect(canReattachPanel({ type: 'panel', id: 'foreign', originProjectId: 'other', title: 'F' }, layout)).toBe(false);

    const result = reattachPanel(layout, sub, 'foreign', 'newtab');
    expect(result.reattached).toBe(false);
    expect(result.layout).toEqual(layout);
    expect(isMainLayoutValid(result.layout)).toBe(true);
  });
});
