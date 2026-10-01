/**
 * 048 FR-035 (research R6 "Migration", data-model "Panel") — custom panel titles migrate away.
 *
 * A layout persisted before 048 may carry `titleIsCustom` / `defaultTitle` on a panel the user
 * renamed. On load, a custom title is replaced by the title the panel was created with, and both
 * fields go. Nothing else changes — ids above all (FR-034) — and running it twice equals running it
 * once. Sub-workspace (and so tear-off) documents carry panels in tabs too, and take the same pass.
 */
import { describe, expect, it } from 'vitest';
import { dropCustomPanelTitles, renameLegacyDefaultTitles } from '../../src/workspace/panel-title-migration.js';
import type { LayoutNode, SubWorkspace, WorkspaceLayout } from '../../src/workspace/model.js';

/** A pre-048 panel as it sits in a persisted document — the two removed fields included. */
type LegacyPanel = Record<string, unknown> & { type: 'panel'; id: string };

const panel = (id: string, over: Record<string, unknown> = {}): LegacyPanel => ({
  type: 'panel',
  id,
  originProjectId: 'proj',
  title: id,
  ...over,
});

const legacyLayout = (): WorkspaceLayout =>
  ({
    projectId: 'proj',
    schemaVersion: 3,
    activeTabId: 't1',
    tabs: [
      {
        id: 't1',
        title: 'Tab 1',
        activePanelId: 'p3',
        root: {
          type: 'split',
          orientation: 'row',
          sizes: [0.3, 0.7],
          children: [
            panel('p1', { title: 'Panel 1' }),
            {
              type: 'split',
              orientation: 'column',
              sizes: [0.55, 0.45],
              children: [
                panel('p3', { title: 'Build', titleIsCustom: true, defaultTitle: 'Panel 3', kind: 'terminal', config: { shellId: 'pwsh' }, zoom: 2 }),
                panel('p4', { title: 'Notes', titleIsCustom: true }),
              ],
            },
          ],
        },
      },
      {
        id: 't2',
        title: 'Tab 2',
        root: panel('p5', { title: 'Panel 5', titleIsCustom: false, defaultTitle: 'Panel 5' }),
      },
    ],
  }) as unknown as WorkspaceLayout;

const panelsOf = (node: LayoutNode): Record<string, unknown>[] =>
  node.type === 'panel' ? [node as unknown as Record<string, unknown>] : node.children.flatMap(panelsOf);

const allPanels = (doc: { tabs: { root: LayoutNode }[] }): Record<string, unknown>[] =>
  doc.tabs.flatMap((t) => panelsOf(t.root));

/** The document with every panel's title and the two removed fields blanked — what must NOT change. */
const skeleton = (doc: unknown): unknown =>
  JSON.parse(JSON.stringify(doc), (key, value: unknown) =>
    key === 'title' || key === 'titleIsCustom' || key === 'defaultTitle' ? undefined : value,
  );

describe('dropCustomPanelTitles (FR-035)', () => {
  it('replaces a custom title with the panel’s default title and removes both fields', () => {
    const out = allPanels(dropCustomPanelTitles(legacyLayout()));
    const p3 = out.find((p) => p.id === 'p3');
    expect(p3?.title).toBe('Panel 3');
    expect(p3).not.toHaveProperty('titleIsCustom');
    expect(p3).not.toHaveProperty('defaultTitle');
  });

  it('keeps the title when titleIsCustom has no defaultTitle to fall back to', () => {
    const p4 = allPanels(dropCustomPanelTitles(legacyLayout())).find((p) => p.id === 'p4');
    expect(p4?.title).toBe('Notes');
    expect(p4).not.toHaveProperty('titleIsCustom');
  });

  it('strips the fields from a panel that was never custom without touching its title', () => {
    const p5 = allPanels(dropCustomPanelTitles(legacyLayout())).find((p) => p.id === 'p5');
    expect(p5).toEqual({ type: 'panel', id: 'p5', originProjectId: 'proj', title: 'Panel 5' });
  });

  it('leaves no panel anywhere carrying either field', () => {
    for (const p of allPanels(dropCustomPanelTitles(legacyLayout()))) {
      expect(p, String(p.id)).not.toHaveProperty('titleIsCustom');
      expect(p, String(p.id)).not.toHaveProperty('defaultTitle');
    }
  });

  it('changes nothing else — ids, sizes, tree shape, kinds, configs, zoom and tab data (FR-034, SC-008)', () => {
    const before = legacyLayout();
    const after = dropCustomPanelTitles(before);
    expect(skeleton(after)).toEqual(skeleton(before));
    expect(after.tabs.map((t) => t.title)).toEqual(['Tab 1', 'Tab 2']);
  });

  it('is idempotent — twice equals once', () => {
    const once = dropCustomPanelTitles(legacyLayout());
    expect(dropCustomPanelTitles(once)).toEqual(once);
  });

  it('returns a document with no legacy field by identity', () => {
    const once = dropCustomPanelTitles(legacyLayout());
    expect(dropCustomPanelTitles(once)).toBe(once);
  });

  it('does not mutate its input', () => {
    const before = legacyLayout();
    const copy = JSON.parse(JSON.stringify(before)) as unknown;
    dropCustomPanelTitles(before);
    expect(before).toEqual(copy);
  });

  it('never throws on a malformed document — it passes through for validation to report', () => {
    const noTabs = { projectId: 'proj' } as unknown as WorkspaceLayout;
    expect(dropCustomPanelTitles(noTabs)).toBe(noTabs);
    const noRoot = { projectId: 'proj', tabs: [{ id: 't1', title: 'Tab 1' }] } as unknown as WorkspaceLayout;
    expect(dropCustomPanelTitles(noRoot)).toBe(noRoot);
    const noChildren = { projectId: 'proj', tabs: [{ id: 't1', title: 'T', root: { type: 'split' } }] } as unknown as WorkspaceLayout;
    expect(dropCustomPanelTitles(noChildren)).toBe(noChildren);
  });

  it('migrates a sub-workspace (tear-off) document the same way', () => {
    const sub = {
      id: 's1',
      ownerUser: 'u',
      name: 'Blue',
      colour: '#00f',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      tabs: [{ id: 'st', title: 'Tab 1', root: panel('p9', { title: 'Mine', titleIsCustom: true, defaultTitle: 'Panel 9' }) }],
    } as unknown as SubWorkspace;
    const out = dropCustomPanelTitles(sub);
    expect(out.tabs[0].root).toEqual({ type: 'panel', id: 'p9', originProjectId: 'proj', title: 'Panel 9' });
    expect(skeleton(out)).toEqual(skeleton(sub));
    expect(dropCustomPanelTitles(out)).toBe(out);
  });
});

/**
 * 048 FR-128 — a saved generated "Panel N" title becomes "Blank Panel". The daemon's reconcile then
 * spreads a layout's several Blank Panels across the sequence; this pass only retires the old shape.
 */
describe('renameLegacyDefaultTitles (048 FR-128)', () => {
  const doc = (): WorkspaceLayout =>
    ({
      projectId: 'proj',
      schemaVersion: 3,
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          title: 'Tab 1',
          activePanelId: 'p1',
          root: {
            type: 'split',
            orientation: 'row',
            sizes: [0.5, 0.5],
            children: [
              panel('p1', { title: 'Panel 1' }),
              panel('p2', { title: 'panel 12', kind: 'terminal', config: { flavour: 'pwsh' } }),
            ],
          },
        },
        { id: 't2', title: 'Build', activePanelId: 'p3', root: panel('p3', { title: 'Build' }) },
        { id: 't3', title: 'Tab 3', activePanelId: 'p4', root: panel('p4', { title: 'Panel 1 (2)' }) },
      ],
    }) as unknown as WorkspaceLayout;

  const titles = (l: WorkspaceLayout): string[] =>
    l.tabs.flatMap((t) => {
      const walk = (n: LayoutNode): string[] =>
        n.type === 'panel' ? [n.title] : (n.children as LayoutNode[]).flatMap(walk);
      return walk(t.root);
    });

  it('renames every generated "Panel N" title to "Blank Panel", and nothing else', () => {
    const after = renameLegacyDefaultTitles(doc());
    expect(titles(after)).toEqual(['Blank Panel', 'Blank Panel', 'Build', 'Panel 1 (2)']);
  });

  it('keeps ids, tree shape, sizes, kinds and configs', () => {
    const before = doc();
    const after = renameLegacyDefaultTitles(before);
    const strip = (l: WorkspaceLayout): string =>
      JSON.stringify(l).replace(/"title":"[^"]*"/g, '"title":""');
    expect(strip(after)).toBe(strip(before));
    expect(after.tabs[1]).toBe(before.tabs[1]); // an untouched tab is returned by identity
  });

  it('is idempotent: a second pass returns the document by identity', () => {
    const once = renameLegacyDefaultTitles(doc());
    expect(renameLegacyDefaultTitles(once)).toBe(once);
  });

  it('works on a sub-workspace document too', () => {
    const sub = { id: 's1', name: 'S', tabs: doc().tabs } as unknown as SubWorkspace;
    expect(titles(renameLegacyDefaultTitles(sub) as unknown as WorkspaceLayout)[0]).toBe('Blank Panel');
  });

  it('passes a malformed document through unchanged', () => {
    const bad = { tabs: [{ id: 't', root: null }] } as unknown as WorkspaceLayout;
    expect(renameLegacyDefaultTitles(bad)).toBe(bad);
    const none = {} as unknown as WorkspaceLayout;
    expect(renameLegacyDefaultTitles(none)).toBe(none);
  });
});
