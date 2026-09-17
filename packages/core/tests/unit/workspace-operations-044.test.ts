import { describe, it, expect } from 'vitest';
import { addPanelBeside, removePanelsWhere } from '../../src/workspace/operations.js';
import { collectPanels, isMainLayoutValid } from '../../src/workspace/invariants.js';
import type { LayoutNode, Panel, WorkspaceLayout } from '../../src/workspace/model.js';

/**
 * 044 T012 — the two layout operations previews add.
 *
 * `addPanelBeside` is where a preview opens next to its parent editor (FR-010, preview on the right)
 * and where Open in Editor places the editor next to a standalone preview (FR-015c, editor on the
 * left): it splits the target's OWN slot, wherever in the tree that slot is.
 *
 * `removePanelsWhere` is how disabling a provider closes its previews (FR-063) — as closing each by
 * hand would (FR-064), except that the workspace's very last panel is replaced by an empty one rather
 * than refused, so the workspace keeps the tab and panel 002 FR-016 requires.
 */

const P = (id: string, over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id,
  originProjectId: 'proj',
  title: id,
  ...over,
});

const pv = (id: string): Panel => P(id, { kind: 'preview', config: { filePath: `C:/proj/${id}.md` } });

const layout = (tabs: { id: string; root: LayoutNode; activePanelId?: string }[], activeTabId = tabs[0].id): WorkspaceLayout => ({
  projectId: 'proj',
  schemaVersion: 3,
  tabs: tabs.map((t) => ({ title: t.id, ...t })),
  activeTabId,
});

const ids = (l: WorkspaceLayout): string[] => l.tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id));

describe('addPanelBeside (FR-010, FR-015c)', () => {
  // Tab root: a column of [p1, row[p2, p3]] — the target sits inside a NESTED split.
  const nested = (): WorkspaceLayout =>
    layout([
      {
        id: 't1',
        root: {
          type: 'split',
          orientation: 'column',
          sizes: [0.4, 0.6],
          children: [P('p1'), { type: 'split', orientation: 'row', sizes: [0.7, 0.3], children: [P('p2'), P('p3')] }],
        },
      },
    ]);

  it("'right' splits the target's own slot with the new panel on the right", () => {
    const before = nested();
    const after = addPanelBeside(before, 'p2', 'right', pv('new'));
    expect(after.tabs[0].root).toEqual({
      type: 'split',
      orientation: 'column',
      sizes: [0.4, 0.6],
      children: [
        P('p1'),
        {
          type: 'split',
          orientation: 'row',
          sizes: [0.7, 0.3],
          children: [{ type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('p2'), pv('new')] }, P('p3')],
        },
      ],
    });
    expect(isMainLayoutValid(after)).toBe(true);
    // Structural, never mutating.
    expect(before).toEqual(nested());
  });

  it("'left' puts the new panel on the left", () => {
    const after = addPanelBeside(nested(), 'p1', 'left', P('ed', { kind: 'editor' }));
    const column = after.tabs[0].root as Extract<LayoutNode, { type: 'split' }>;
    expect(column.children[0]).toEqual({
      type: 'split',
      orientation: 'row',
      sizes: [0.5, 0.5],
      children: [P('ed', { kind: 'editor' }), P('p1')],
    });
    expect(ids(after)).toEqual(['ed', 'p1', 'p2', 'p3']);
  });

  it('works on a tab whose root is the target itself, and in a non-active tab', () => {
    const l = layout([{ id: 't1', root: P('p1') }, { id: 't2', root: P('p2') }]);
    const after = addPanelBeside(l, 'p2', 'right', pv('new'));
    expect(after.tabs[0]).toBe(l.tabs[0]);
    expect(after.tabs[1].root).toEqual({ type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('p2'), pv('new')] });
    expect(after.activeTabId).toBe('t1');
  });

  it('returns the same layout for an unknown target, or a panel id already present', () => {
    const l = nested();
    expect(addPanelBeside(l, 'nope', 'right', pv('new'))).toBe(l);
    expect(addPanelBeside(l, 'p2', 'right', P('p3'))).toBe(l);
  });
});

describe('removePanelsWhere (FR-063, FR-064, FR-067)', () => {
  const isPreview = (p: Panel): boolean => p.kind === 'preview';
  const neverCalled = (): string => {
    throw new Error('no replacement panel was needed');
  };

  it('collapses the removed panel’s slot', () => {
    const l = layout([
      { id: 't1', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('ed'), pv('pv')] }, activePanelId: 'pv' },
    ]);
    const after = removePanelsWhere(l, isPreview, neverCalled);
    expect(after.tabs).toHaveLength(1);
    expect(after.tabs[0].root).toEqual(P('ed'));
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('closes a tab the removal empties, and repairs the active tab', () => {
    const l = layout([{ id: 't1', root: P('ed') }, { id: 't2', root: pv('pv') }], 't2');
    const after = removePanelsWhere(l, isPreview, neverCalled);
    expect(after.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(after.activeTabId).toBe('t1');
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('removes every match, across tabs and nested splits', () => {
    const l = layout([
      {
        id: 't1',
        root: {
          type: 'split',
          orientation: 'column',
          sizes: [0.5, 0.5],
          children: [pv('a'), { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('ed'), pv('b')] }],
        },
      },
      { id: 't2', root: pv('c') },
      { id: 't3', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [pv('d'), P('term', { kind: 'terminal' })] } },
    ]);
    const after = removePanelsWhere(l, isPreview, neverCalled);
    expect(ids(after)).toEqual(['ed', 'term']);
    expect(after.tabs.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('replaces the workspace’s LAST panel with a fresh untyped panel — new id, default title', () => {
    const l = layout([{ id: 't1', root: pv('only'), activePanelId: 'only' }]);
    const after = removePanelsWhere(l, isPreview, () => 'fresh');
    expect(after.tabs).toHaveLength(1);
    expect(after.tabs[0].id).toBe('t1');
    expect(after.tabs[0].root).toEqual({ type: 'panel', id: 'fresh', originProjectId: 'proj', title: 'Panel 1' });
    expect(after.tabs[0].activePanelId).toBe('fresh');
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('when EVERY panel matches, the workspace ends with exactly one fresh panel', () => {
    const l = layout([{ id: 't1', root: pv('a') }, { id: 't2', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [pv('b'), pv('c')] } }]);
    let calls = 0;
    const after = removePanelsWhere(l, isPreview, () => `fresh-${++calls}`);
    expect(calls).toBe(1);
    expect(ids(after)).toEqual(['fresh-1']);
    expect(after.tabs).toHaveLength(1);
    expect(isMainLayoutValid(after)).toBe(true);
  });

  it('is idempotent: a second run changes nothing and returns the same layout', () => {
    const l = layout([{ id: 't1', root: pv('only') }, { id: 't2', root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [P('ed'), pv('x')] } }]);
    const once = removePanelsWhere(l, isPreview, () => 'fresh');
    const twice = removePanelsWhere(once, isPreview, neverCalled);
    expect(twice).toBe(once);
  });

  it('returns the same layout when nothing matches', () => {
    const l = layout([{ id: 't1', root: P('ed') }]);
    expect(removePanelsWhere(l, isPreview, neverCalled)).toBe(l);
  });
});
