/**
 * T127 (044 US4) — turning a provider off purges its previews from layouts no window holds (FR-063,
 * FR-064; research R19, O6; contracts/preview-ipc.md §5).
 *
 * ══ WHY INTEGRATION ══
 *
 * `purgeUnloadedPreviews` is main's walk over every project layout and every sub-workspace record
 * through the daemon's EXISTING RPCs (`projects.list`, `workspace.load/save/loadSubWorkspaces/
 * persistSubWorkspaces`) — no new RPC. The daemon here is a fake at that RPC boundary holding real
 * layout documents, which is the whole of what the walk touches: the pure layout operations it composes
 * (`removePanelsWhere`, `stripPanelFromSubWorkspaces`, `previewPathOf`) run for real.
 *
 * ══ WHAT IS PROVED ══
 *
 * - Previews matching on `previewPathOf(config)` (history's current entry, else `filePath`) are removed
 *   from every project layout and sub-workspace record NOT held by a window (O6).
 * - A record that did not restore (`restored: false` — missing or corrupt) is never written: saving it
 *   would persist the default the daemon synthesised in its place.
 * - A workspace's last panel becomes an empty panel (FR-064, 002 FR-016); a sub-workspace left with no
 *   panel is dropped, per `stripPanelFromSubWorkspaces` (003 FR-026b).
 * - A second run writes NOTHING (the idempotent-migration constraint).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every layout that loses a preview also holds a panel that must survive, and the held records hold a
 * matching preview that must survive — so a walk that removed everything, or ignored the held set,
 * fails.
 */
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createPreviewProviderRegistry,
  LAYOUT_SCHEMA_VERSION,
  type LayoutNode,
  type Panel,
  type SubWorkspace,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import { previewPurgePredicate, purgeUnloadedPreviews } from '../../src/main/preview-purge.js';

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
  { id: 'otherText', displayName: 'Other text', extensions: ['.othertxt'], kind: 'text' },
]);
/** `testText` was just turned off. */
const turnedOff = previewPurgePredicate(registry, ['testText']);

const preview = (id: string, origin: string, file: string, history?: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: origin,
  title: `Panel ${id}`,
  kind: PREVIEW_KIND,
  config: {
    filePath: `D:/p/${file}`,
    ...(history !== undefined ? { history: { v: 1, entries: [{ filePath: `D:/p/${history}` }], index: 0 } } : {}),
  },
});
const plain = (id: string, origin: string): Panel => ({ type: 'panel', id, originProjectId: origin, title: `Panel ${id}` });
const row = (...children: Panel[]): LayoutNode =>
  children.length === 1 ? children[0] : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };
const tabsOf = (roots: LayoutNode[]): Tab[] => roots.map((root, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root }));
const layoutOf = (projectId: string, roots: LayoutNode[]): WorkspaceLayout => ({
  projectId,
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  tabs: tabsOf(roots),
  activeTabId: 't1',
});
const sub = (id: string, roots: LayoutNode[]): SubWorkspace => ({
  id,
  ownerUser: 'u',
  name: id,
  colour: '#336699',
  tabs: tabsOf(roots),
  bounds: { x: 0, y: 0, width: 800, height: 600 },
});
const panelIds = (tabs: readonly Tab[]): string[] => tabs.flatMap((t) => collectPanels(t.root).map((p) => p.id));

interface Stored {
  layout: WorkspaceLayout;
  restored: boolean;
  reason?: 'missing' | 'corrupt';
}

/** The daemon, at its RPC boundary: real documents, and a log of every write. */
function fakeDaemon(projects: Record<string, Stored>, subs: SubWorkspace[]) {
  const state = { projects, subs };
  const writes: Array<{ method: string; params: unknown }> = [];
  const call = <T>(method: string, params?: unknown): Promise<T> => {
    const p = params as { projectId?: string; layout?: WorkspaceLayout; subWorkspaces?: SubWorkspace[] };
    switch (method) {
      case 'projects.list':
        return Promise.resolve({
          projects: Object.keys(state.projects).map((id) => ({ id, name: id, rootFolder: `D:/${id}` })),
        } as T);
      case 'workspace.load': {
        const stored = state.projects[p.projectId!];
        return Promise.resolve(structuredClone(stored) as T);
      }
      case 'workspace.save':
        writes.push({ method, params: structuredClone(params) });
        state.projects[p.projectId!] = { layout: structuredClone(p.layout!), restored: true };
        return Promise.resolve({ ok: true } as T);
      case 'workspace.loadSubWorkspaces':
        return Promise.resolve({ subWorkspaces: structuredClone(state.subs) } as T);
      case 'workspace.persistSubWorkspaces':
        writes.push({ method, params: structuredClone(params) });
        state.subs = structuredClone(p.subWorkspaces!);
        return Promise.resolve({ ok: true } as T);
      default:
        return Promise.reject(new Error(`unexpected RPC from the preview purge: ${method}`));
    }
  };
  return { call, writes, state };
}

function deps(daemon: ReturnType<typeof fakeDaemon>, held: { projectIds?: string[]; subWorkspaceIds?: string[] } = {}) {
  let n = 0;
  const notified: string[] = [];
  return {
    call: daemon.call,
    held: () =>
      Promise.resolve({
        projectIds: new Set(held.projectIds ?? []),
        subWorkspaceIds: new Set(held.subWorkspaceIds ?? []),
      }),
    newPanelId: () => `placeholder-${++n}`,
    notifySubWorkspaceChanged: (id: string) => notified.push(id),
    notified,
  };
}

describe('purgeUnloadedPreviews over project layouts (FR-063, FR-064)', () => {
  it('removes matching previews from every unheld layout, keeps other panels, and skips the held one', async () => {
    const daemon = fakeDaemon(
      {
        A: { layout: layoutOf('A', [row(preview('a1', 'A', 'x.prvtxt'), plain('a2', 'A')), preview('a3', 'A', 'y.prvtxt')]), restored: true },
        B: { layout: layoutOf('B', [row(preview('b1', 'B', 'o.othertxt'), preview('b2', 'B', 'z.prvtxt'))]), restored: true },
        HELD: { layout: layoutOf('HELD', [row(preview('h1', 'HELD', 'h.prvtxt'), plain('h2', 'HELD'))]), restored: true },
      },
      [],
    );

    const result = await purgeUnloadedPreviews(deps(daemon, { projectIds: ['HELD'] }), turnedOff);

    expect(panelIds(daemon.state.projects.A.layout.tabs)).toEqual(['a2']);
    // A tab the purge emptied closed, as closing by hand would.
    expect(daemon.state.projects.A.layout.tabs).toHaveLength(1);
    // Another provider's preview stays.
    expect(panelIds(daemon.state.projects.B.layout.tabs)).toEqual(['b1']);
    // The held layout is the window's to close (PreviewProviderSync) — the daemon copy is not touched.
    expect(panelIds(daemon.state.projects.HELD.layout.tabs)).toEqual(['h1', 'h2']);
    expect(daemon.writes.filter((w) => w.method === 'workspace.save').map((w) => (w.params as { projectId: string }).projectId).sort()).toEqual(['A', 'B']);
    expect([...result.removedPanelIds].sort()).toEqual(['a1', 'a3', 'b2']);
  });

  it('matches on the history’s current entry, else filePath — the attach precedence', async () => {
    const daemon = fakeDaemon(
      {
        A: {
          layout: layoutOf('A', [
            row(
              preview('shows-off', 'A', 'm.othertxt', 'm.prvtxt'),
              preview('shows-other', 'A', 'n.prvtxt', 'n.othertxt'),
              plain('keep', 'A'),
            ),
          ]),
          restored: true,
        },
      },
      [],
    );

    await purgeUnloadedPreviews(deps(daemon), turnedOff);

    expect(panelIds(daemon.state.projects.A.layout.tabs)).toEqual(['shows-other', 'keep']);
  });

  it('replaces a workspace’s last panel with an empty panel (002 FR-016)', async () => {
    const daemon = fakeDaemon({ A: { layout: layoutOf('A', [preview('only', 'A', 'o.prvtxt')]), restored: true } }, []);

    await purgeUnloadedPreviews(deps(daemon), turnedOff);

    const tabs = daemon.state.projects.A.layout.tabs;
    expect(tabs).toHaveLength(1);
    const panels = collectPanels(tabs[0].root);
    expect(panels.map((p) => p.id)).toEqual(['placeholder-1']);
    expect(panels[0].kind).toBeUndefined();
  });

  it('never writes a record that did not restore (missing or corrupt)', async () => {
    const daemon = fakeDaemon(
      {
        MISSING: { layout: layoutOf('MISSING', [preview('m', 'MISSING', 'm.prvtxt')]), restored: false, reason: 'missing' },
        CORRUPT: { layout: layoutOf('CORRUPT', [preview('c', 'CORRUPT', 'c.prvtxt')]), restored: false, reason: 'corrupt' },
      },
      [],
    );

    await purgeUnloadedPreviews(deps(daemon), turnedOff);

    expect(daemon.writes).toEqual([]);
  });
});

describe('purgeUnloadedPreviews over sub-workspace records (FR-063)', () => {
  it('strips matching previews from unheld records, drops a record left empty, and leaves the held one', async () => {
    const daemon = fakeDaemon({}, [
      sub('keeps-one', [row(preview('k1', 'subworkspace:keeps-one', 'k.prvtxt'), plain('k2', 'subworkspace:keeps-one'))]),
      sub('emptied', [preview('e1', 'P', 'e.prvtxt')]),
      sub('untouched', [preview('u1', 'P', 'u.othertxt')]),
      sub('held', [preview('h1', 'P', 'h.prvtxt')]),
    ]);
    const d = deps(daemon, { subWorkspaceIds: ['held'] });

    const result = await purgeUnloadedPreviews(d, turnedOff);

    const byId = new Map(daemon.state.subs.map((s) => [s.id, s]));
    expect(panelIds(byId.get('keeps-one')!.tabs)).toEqual(['k2']);
    expect(byId.has('emptied'), 'a sub-workspace cannot exist empty (003 FR-026b)').toBe(false);
    expect(panelIds(byId.get('untouched')!.tabs)).toEqual(['u1']);
    expect(panelIds(byId.get('held')!.tabs)).toEqual(['h1']);
    expect(daemon.writes.filter((w) => w.method === 'workspace.persistSubWorkspaces')).toHaveLength(1);
    expect(result.deletedSubWorkspaceIds).toEqual(['emptied']);
    // 044 US4 fix round 1, item 1 — a rewritten-but-kept record ('keeps-one') and a deleted one
    // ('emptied') both get the same broadcast a hand destroy sends; an untouched or held record does
    // not, and the notify happens only once the record actually landed.
    expect(result.changedSubWorkspaceIds).toEqual(['keeps-one']);
    expect(d.notified.sort()).toEqual(['emptied', 'keeps-one']);
  });

  it('writes no record set when no sub-workspace holds a match, and notifies no window', async () => {
    const daemon = fakeDaemon({}, [sub('untouched', [preview('u1', 'P', 'u.othertxt')])]);
    const d = deps(daemon);

    await purgeUnloadedPreviews(d, turnedOff);

    expect(daemon.writes).toEqual([]);
    expect(d.notified).toEqual([]);
  });
});

describe('the purge is idempotent', () => {
  it('a second run over already-purged records writes nothing', async () => {
    const daemon = fakeDaemon(
      {
        A: { layout: layoutOf('A', [row(preview('a1', 'A', 'x.prvtxt'), plain('a2', 'A'))]), restored: true },
        L: { layout: layoutOf('L', [preview('only', 'L', 'o.prvtxt')]), restored: true },
      },
      [sub('s', [row(preview('s1', 'P', 's.prvtxt'), plain('s2', 'P'))])],
    );
    const d = deps(daemon);

    await purgeUnloadedPreviews(d, turnedOff);
    expect(daemon.writes.length).toBeGreaterThan(0);
    const afterFirst = daemon.writes.length;

    const second = await purgeUnloadedPreviews(d, turnedOff);

    expect(daemon.writes).toHaveLength(afterFirst);
    expect(second.removedPanelIds).toEqual([]);
  });
});
