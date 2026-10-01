import { describe, it, expect } from 'vitest';
import {
  addPanel,
  addTab,
  createDefaultLayout,
  movePanelToOuterEdge,
  removePanelsWhere,
  splitPanel,
  type SplitDirection,
} from '../../src/workspace/operations.js';
import { collectPanels, isMainLayoutValid } from '../../src/workspace/invariants.js';
import type { LayoutNode, Panel, SplitNode, WorkspaceLayout } from '../../src/workspace/model.js';

/**
 * 048 — the layout operations panel splitting adds.
 *
 * `splitPanel` (FR-001, FR-004) divides ONE panel's slot 50/50 and puts a new placeholder on the named
 * side; nothing else in the tree changes, which is structural (the target leaf is the only node
 * replaced), so these tests compare nodes by identity rather than measuring.
 */

const P = (id: string, over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id,
  originProjectId: 'proj',
  title: id,
  ...over,
});

const layout = (
  tabs: { id: string; root: LayoutNode; activePanelId?: string }[],
  activeTabId = tabs[0].id,
): WorkspaceLayout => ({
  projectId: 'proj',
  schemaVersion: 3,
  tabs: tabs.map((t) => ({ title: t.id, ...t })),
  activeTabId,
});

/** A 2x2: column root of two rows. */
const grid = (): WorkspaceLayout =>
  layout([
    {
      id: 't1',
      activePanelId: 'tl',
      root: {
        type: 'split',
        orientation: 'column',
        sizes: [0.4, 0.6],
        children: [
          { type: 'split', orientation: 'row', sizes: [0.3, 0.7], children: [P('tl'), P('tr')] },
          { type: 'split', orientation: 'row', sizes: [0.55, 0.45], children: [P('bl'), P('br')] },
        ],
      },
    },
  ]);

const rootOf = (l: WorkspaceLayout, tabId = 't1'): LayoutNode => {
  const tab = l.tabs.find((t) => t.id === tabId);
  if (!tab) throw new Error(`no tab ${tabId}`);
  return tab.root;
};

const asSplit = (n: LayoutNode): SplitNode => {
  if (n.type !== 'split') throw new Error('expected a split');
  return n;
};

const cases: { direction: SplitDirection; orientation: 'row' | 'column'; newFirst: boolean }[] = [
  { direction: 'down', orientation: 'column', newFirst: false },
  { direction: 'up', orientation: 'column', newFirst: true },
  { direction: 'right', orientation: 'row', newFirst: false },
  { direction: 'left', orientation: 'row', newFirst: true },
];

describe('splitPanel (FR-001)', () => {
  for (const { direction, orientation, newFirst } of cases) {
    it(`${direction}: replaces only the target leaf with a 50/50 ${orientation} split, new panel ${newFirst ? 'first' : 'second'}`, () => {
      const before = grid();
      const after = splitPanel(before, 't1', 'bl', direction, { id: 'new', title: 'Panel 5' });

      const beforeRoot = asSplit(rootOf(before));
      const afterRoot = asSplit(rootOf(after));
      // The other three panels keep identical nodes and sizes (SC-002).
      expect(afterRoot.sizes).toEqual(beforeRoot.sizes);
      expect(afterRoot.children[0]).toBe(beforeRoot.children[0]);
      const beforeBottom = asSplit(beforeRoot.children[1]);
      const afterBottom = asSplit(afterRoot.children[1]);
      expect(afterBottom.sizes).toEqual(beforeBottom.sizes);
      expect(afterBottom.children[1]).toBe(beforeBottom.children[1]);

      const slot = asSplit(afterBottom.children[0]);
      expect(slot.orientation).toBe(orientation);
      expect(slot.sizes).toEqual([0.5, 0.5]);
      const [first, second] = slot.children as Panel[];
      const created = newFirst ? first : second;
      const original = newFirst ? second : first;
      expect(original).toBe(beforeBottom.children[0]);
      expect(created).toEqual({ type: 'panel', id: 'new', originProjectId: 'proj', title: 'Panel 5' });
      expect(isMainLayoutValid(after)).toBe(true);
    });
  }

  it('splits a lone root panel', () => {
    const before = layout([{ id: 't1', root: P('only') }]);
    const after = splitPanel(before, 't1', 'only', 'right', { id: 'new', title: 'Panel 2' });
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('row');
    expect(root.children.map((c) => (c as Panel).id)).toEqual(['only', 'new']);
  });

  it('splits a member of a single row without touching its siblings', () => {
    const row: LayoutNode = { type: 'split', orientation: 'row', sizes: [0.2, 0.5, 0.3], children: [P('a'), P('b'), P('c')] };
    const before = layout([{ id: 't1', root: row }]);
    const after = splitPanel(before, 't1', 'b', 'down', { id: 'new', title: 'Panel 4' });
    const root = asSplit(rootOf(after));
    expect(root.sizes).toEqual([0.2, 0.5, 0.3]);
    expect(root.children[0]).toBe(row.children[0]);
    expect(root.children[2]).toBe(row.children[2]);
    const slot = asSplit(root.children[1]);
    expect(slot.orientation).toBe('column');
    expect(slot.children.map((c) => (c as Panel).id)).toEqual(['b', 'new']);
  });

  it('starts the new panel at the default zoom and leaves a zoomed target at its own (FR-004)', () => {
    const before = layout([{ id: 't1', root: P('z', { zoom: 3 }) }]);
    const after = splitPanel(before, 't1', 'z', 'up', { id: 'new', title: 'Panel 2' });
    const panels = collectPanels(rootOf(after));
    expect(panels.find((p) => p.id === 'z')?.zoom).toBe(3);
    expect(panels.find((p) => p.id === 'new')).not.toHaveProperty('zoom');
  });

  it('makes the new panel the tab’s active panel', () => {
    const after = splitPanel(grid(), 't1', 'tr', 'left', { id: 'new', title: 'Panel 5' });
    expect(after.tabs[0].activePanelId).toBe('new');
  });

  it('keeps the target’s kind and config untouched (a parented preview stays parented)', () => {
    const preview = P('pv', { kind: 'preview', config: { filePath: 'C:/proj/a.md', parentPanelId: 'ed' } });
    const fif = P('fif', { kind: 'findInFiles', config: { query: 'x' } });
    const before = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [preview, fif] } },
    ]);
    const a = splitPanel(before, 't1', 'pv', 'down', { id: 'n1', title: 'Panel 3' });
    const b = splitPanel(a, 't1', 'fif', 'right', { id: 'n2', title: 'Panel 4' });
    const panels = collectPanels(rootOf(b));
    expect(panels.find((p) => p.id === 'pv')).toBe(preview);
    expect(panels.find((p) => p.id === 'fif')).toBe(fif);
  });

  it('leaves other tabs untouched by identity', () => {
    const before = layout([
      { id: 't1', root: P('a') },
      { id: 't2', root: P('b') },
    ]);
    const after = splitPanel(before, 't1', 'a', 'down', { id: 'new', title: 'Panel 3' });
    expect(after.tabs[1]).toBe(before.tabs[1]);
  });

  it('returns the same layout for an unknown tab, an unknown panel, or a panel in another tab', () => {
    const before = layout([
      { id: 't1', root: P('a') },
      { id: 't2', root: P('b') },
    ]);
    expect(splitPanel(before, 'nope', 'a', 'down', { id: 'new', title: 'Panel 3' })).toBe(before);
    expect(splitPanel(before, 't1', 'nope', 'down', { id: 'new', title: 'Panel 3' })).toBe(before);
    expect(splitPanel(before, 't1', 'b', 'down', { id: 'new', title: 'Panel 3' })).toBe(before);
  });

  it('refuses a new id already in the layout (a panel is never duplicated)', () => {
    const before = grid();
    expect(splitPanel(before, 't1', 'tl', 'down', { id: 'br', title: 'Panel 5' })).toBe(before);
  });
});

/**
 * `movePanelToOuterEdge` (FR-061–FR-063, FR-067) — a drop on a tab's outer-edge band. The panel is
 * removed by the ordinary collapse rules, then runs along the whole edge at one third of the drop
 * axis; the rest keeps its arrangement and relative proportions.
 */
describe('movePanelToOuterEdge (FR-061–FR-063, FR-067)', () => {
  /** The 2x2 of `grid()` beside a fifth panel: row [grid, p5]. */
  const gridAndFifth = (): WorkspaceLayout => {
    const g = rootOf(grid());
    return layout([
      { id: 't1', activePanelId: 'tl', root: { type: 'split', orientation: 'row', sizes: [0.7, 0.3], children: [g, P('p5')] } },
    ]);
  };

  const sizesClose = (actual: number[], expected: number[]): void => {
    expect(actual.length).toBe(expected.length);
    actual.forEach((s, i) => expect(s).toBeCloseTo(expected[i], 10));
  };

  it('left drop on a column root wraps it in a row [panel, root] at [1/3, 2/3], the 2x2 untouched', () => {
    const before = gridAndFifth();
    const g = asSplit(rootOf(before)).children[0];
    const after = movePanelToOuterEdge(before, 'p5', 't1', 'left');
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('row');
    expect((root.children[0] as Panel).id).toBe('p5');
    expect(root.children[1]).toBe(g); // the collapsed-out column root, by identity
    sizesClose(root.sizes, [1 / 3, 2 / 3]);
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('bottom drop on a row root wraps it in a column [root, panel] at [2/3, 1/3]', () => {
    const inner: LayoutNode = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('b'), P('c')] };
    const row: LayoutNode = {
      type: 'split',
      orientation: 'row',
      sizes: [0.5, 0.5],
      children: [{ type: 'split', orientation: 'column', sizes: [0.5, 0.5], children: [P('a'), P('d')] }, inner],
    };
    const before = layout([{ id: 't1', root: row }]);
    const after = movePanelToOuterEdge(before, 'b', 't1', 'bottom');
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('column');
    expect((root.children[1] as Panel).id).toBe('b');
    const rest = asSplit(root.children[0]);
    expect(rest.orientation).toBe('row');
    // `b` left its row, which collapsed to `c`; the column [a, d] is untouched.
    expect(rest.children[0]).toBe((row as SplitNode).children[0]);
    expect((rest.children[1] as Panel).id).toBe('c');
    sizesClose(rest.sizes, [0.5, 0.5]);
    sizesClose(root.sizes, [2 / 3, 1 / 3]);
  });

  it('bottom drop whose remaining root is already a column joins it as the last member', () => {
    const row: LayoutNode = {
      type: 'split',
      orientation: 'row',
      sizes: [0.5, 0.5],
      children: [P('a'), { type: 'split', orientation: 'column', sizes: [0.4, 0.6], children: [P('b'), P('c')] }],
    };
    const after = movePanelToOuterEdge(layout([{ id: 't1', root: row }]), 'a', 't1', 'bottom');
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('column');
    expect(root.children.map((c) => (c as Panel).id)).toEqual(['b', 'c', 'a']);
    sizesClose(root.sizes, [0.4 * (2 / 3), 0.6 * (2 / 3), 1 / 3]);
  });

  it('top drop on a row root puts the panel first', () => {
    const before = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.2, 0.3, 0.5], children: [P('a'), P('b'), P('c')] } },
    ]);
    const after = movePanelToOuterEdge(before, 'b', 't1', 'top');
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('column');
    expect((root.children[0] as Panel).id).toBe('b');
    sizesClose(root.sizes, [1 / 3, 2 / 3]);
    const rest = asSplit(root.children[1]);
    expect(rest.children.map((c) => (c as Panel).id)).toEqual(['a', 'c']);
    sizesClose(rest.sizes, [0.2 / 0.7, 0.5 / 0.7]);
  });

  it('a root already along the drop axis gains the panel as a new last member at 1/3, the others scaled by 2/3 (FR-063)', () => {
    const before = layout([
      {
        id: 't1',
        root: {
          type: 'split',
          orientation: 'row',
          sizes: [0.25, 0.75],
          children: [P('a'), { type: 'split', orientation: 'column', sizes: [0.5, 0.5], children: [P('b'), P('x')] }],
        },
      },
    ]);
    const after = movePanelToOuterEdge(before, 'x', 't1', 'right');
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('row');
    expect(root.children.map((c) => (c.type === 'panel' ? c.id : 'split'))).toEqual(['a', 'b', 'x']);
    sizesClose(root.sizes, [0.25 * (2 / 3), 0.75 * (2 / 3), 1 / 3]);
  });

  it('a root along the axis gains the panel as a new FIRST member on a left drop', () => {
    const before = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.4, 0.6], children: [P('a'), P('b')] } },
      { id: 't2', root: P('z') },
    ]);
    const after = movePanelToOuterEdge(before, 'z', 't1', 'left');
    const root = asSplit(rootOf(after));
    expect(root.children.map((c) => (c as Panel).id)).toEqual(['z', 'a', 'b']);
    sizesClose(root.sizes, [1 / 3, 0.4 * (2 / 3), 0.6 * (2 / 3)]);
  });

  it('keeps the moved panel’s identity and content — id, title, kind, config, zoom (FR-067, FR-034)', () => {
    const moved = P('p5', { title: 'Build', kind: 'terminal', config: { shellId: 'pwsh' } as never, zoom: 2 });
    const g = rootOf(grid());
    const before = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.7, 0.3], children: [g, moved] } },
    ]);
    const after = movePanelToOuterEdge(before, 'p5', 't1', 'top');
    expect(collectPanels(rootOf(after)).find((p) => p.id === 'p5')).toBe(moved);
  });

  it('is a no-op (the same layout object) when the panel already spans that edge alone (FR-067)', () => {
    const before = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.3, 0.7], children: [P('a'), P('b')] } },
    ]);
    expect(movePanelToOuterEdge(before, 'a', 't1', 'left')).toBe(before);
    expect(movePanelToOuterEdge(before, 'b', 't1', 'right')).toBe(before);
    const col = layout([
      { id: 't1', root: { type: 'split', orientation: 'column', sizes: [0.3, 0.7], children: [P('a'), P('b')] } },
    ]);
    expect(movePanelToOuterEdge(col, 'a', 't1', 'top')).toBe(col);
    expect(movePanelToOuterEdge(col, 'b', 't1', 'bottom')).toBe(col);
  });

  it('is NOT a no-op for the first member dropped on the far edge', () => {
    const before = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.3, 0.7], children: [P('a'), P('b')] } },
    ]);
    const after = movePanelToOuterEdge(before, 'a', 't1', 'right');
    const root = asSplit(rootOf(after));
    expect(root.children.map((c) => (c as Panel).id)).toEqual(['b', 'a']);
    sizesClose(root.sizes, [2 / 3, 1 / 3]);
  });

  it('moves a panel across from another tab, and drops the emptied source tab', () => {
    const before = layout(
      [
        { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('a'), P('b')] } },
        { id: 't2', root: P('z') },
      ],
      't2',
    );
    const after = movePanelToOuterEdge(before, 'z', 't1', 'bottom');
    expect(after.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(after.activeTabId).toBe('t1');
    const root = asSplit(rootOf(after));
    expect(root.orientation).toBe('column');
    expect((root.children[1] as Panel).id).toBe('z');
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('returns the same layout for an unknown panel, an unknown tab, or a tab whose only panel is the one moved', () => {
    const before = gridAndFifth();
    expect(movePanelToOuterEdge(before, 'nope', 't1', 'left')).toBe(before);
    expect(movePanelToOuterEdge(before, 'p5', 'nope', 'left')).toBe(before);
    const lone = layout([{ id: 't1', root: P('only') }, { id: 't2', root: P('x') }]);
    expect(movePanelToOuterEdge(lone, 'only', 't1', 'left')).toBe(lone);
  });
});

describe('048 FR-127 — an empty panel is a Blank Panel', () => {
  it('names the default workspace’s placeholder "Blank Panel"', () => {
    const l = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    expect((l.tabs[0].root as Panel).title).toBe('Blank Panel');
  });

  it('names an added panel by the next free place in the sequence, not by a panel count', () => {
    const before = layout([{ id: 't1', root: P('a', { title: 'Blank Panel' }) }]);
    const after = addPanel(before, 't1', 'new');
    expect(collectPanels(after.tabs[0].root).find((p) => p.id === 'new')?.title).toBe('Blank Panel 2');
  });

  it('names a new tab’s placeholder by the sequence across every tab', () => {
    const before = layout([
      { id: 't1', root: P('a', { title: 'Blank Panel' }) },
      { id: 't2', root: P('b', { title: 'Blank Panel 3' }) },
    ]);
    const after = addTab(before, { tab: 't3', panel: 'c' });
    expect((after.tabs[2].root as Panel).title).toBe('Blank Panel 2');
  });

  it('names the placeholder that replaces a workspace’s last panel "Blank Panel"', () => {
    const before = layout([{ id: 't1', root: P('only', { title: 'Build' }) }]);
    const after = removePanelsWhere(before, () => true, () => 'fresh');
    expect((after.tabs[0].root as Panel).title).toBe('Blank Panel');
  });
});
