import { describe, it, expect } from 'vitest';
import {
  stripPanelFromSubWorkspaces,
  findPanelLocations,
  type SubWorkspace,
  type Panel,
  type LayoutNode,
} from '@throng/core';

const BOUNDS = { x: 0, y: 0, width: 800, height: 600, displayId: 'd1' };

function panel(id: string): Panel {
  return { type: 'panel', id, originProjectId: 'proj', title: id };
}

/** A row split of the given panels (helper — avoids depending on internal ops). */
function rowSplit(...ids: string[]): LayoutNode {
  return {
    type: 'split',
    orientation: 'row',
    children: ids.map(panel),
    sizes: ids.map(() => 1 / ids.length),
  };
}

function sub(id: string, name: string, roots: LayoutNode[]): SubWorkspace {
  return {
    id,
    ownerUser: 'u',
    name,
    colour: '#fff',
    bounds: BOUNDS,
    tabs: roots.map((root, i) => ({ id: `${id}-t${i}`, title: `T${i}`, root, activePanelId: '' })),
  };
}

describe('findPanelLocations (FR-026a — where else a panel lives)', () => {
  it('returns the ids of sub-workspaces whose tabs contain the panel', () => {
    const list = [
      sub('s1', 'One', [panel('p1')]),
      sub('s2', 'Two', [rowSplit('p1', 'p2')]),
      sub('s3', 'Three', [panel('p9')]),
    ];
    expect(findPanelLocations(list, 'p1').sort()).toEqual(['s1', 's2']);
    expect(findPanelLocations(list, 'p9')).toEqual(['s3']);
    expect(findPanelLocations(list, 'nope')).toEqual([]);
  });
});

describe('stripPanelFromSubWorkspaces (FR-026/026b — cascade removal)', () => {
  it('removes the panel from every sub-workspace and collapses split slots', () => {
    const list = [
      sub('s1', 'One', [rowSplit('p1', 'p2')]), // p1,p2 split
      sub('s2', 'Two', [panel('p2')]), // p2 only
    ];
    const { list: next, deletedIds } = stripPanelFromSubWorkspaces(list, 'p2');
    // s1 keeps p1 (collapsed to a single panel); s2 emptied → deleted.
    expect(deletedIds).toEqual(['s2']);
    expect(next.map((s) => s.id)).toEqual(['s1']);
    const s1 = next[0];
    expect(s1.tabs.flatMap((t) => t.root.type === 'panel' ? [t.root.id] : [])).toEqual(['p1']);
  });

  it('deletes a sub-workspace whose only panel is removed', () => {
    const list = [sub('s1', 'One', [panel('p1')]), sub('s2', 'Two', [panel('p2')])];
    const { list: next, deletedIds } = stripPanelFromSubWorkspaces(list, 'p1');
    expect(deletedIds).toEqual(['s1']);
    expect(next.map((s) => s.id)).toEqual(['s2']);
  });

  it('is a no-op set when the panel is absent everywhere', () => {
    const list = [sub('s1', 'One', [panel('p1')])];
    const { list: next, deletedIds } = stripPanelFromSubWorkspaces(list, 'ghost');
    expect(deletedIds).toEqual([]);
    expect(next).toHaveLength(1);
  });
});
