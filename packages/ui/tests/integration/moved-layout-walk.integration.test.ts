/**
 * T096 (050 R19, FR-016, FR-035) — after a move lands, main rewrites the layouts NO WINDOW HOLDS.
 *
 * The defect behind MT-02's "Couldn't open … (missing)" toast: a project's layout that no window held kept
 * the moved file's OLD path, so showing that project later opened a path that no longer exists. FR-035 needs
 * the same walk, so a project shown later — or after a restart — already knows its panel's file moved out.
 *
 * The daemon is a fake at its RPC boundary holding real layout documents, as `preview-purge.integration.test.ts`;
 * the walk's pure parts (path rewrite, history rewrite, the project-root test) run for real.
 */
import { describe, expect, it } from 'vitest';
import {
  EDITOR_KIND,
  LAYOUT_SCHEMA_VERSION,
  PREVIEW_KIND,
  collectPanels,
  type LayoutNode,
  type Panel,
  type SubWorkspace,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import { join } from 'node:path';
import { walkMovedLayouts } from '../../src/main/moved-layout-walk.js';
import type { MovePair } from '../../src/main/files-service.js';
import { disposeHarness, makeHarness, put } from './helpers/transfer-harness.js';

const ROOT = { A: 'D:/a', B: 'D:/b' } as const;

const editor = (id: string, origin: string, filePath: string, history?: string[], movedOut?: true): Panel => ({
  type: 'panel',
  id,
  originProjectId: origin,
  title: `Panel ${id}`,
  kind: EDITOR_KIND,
  config: {
    filePath,
    ...(history ? { history: { v: 1, entries: history.map((f) => ({ filePath: f })), index: history.length - 1 } } : {}),
    ...(movedOut ? { movedOut } : {}),
  },
});
const preview = (id: string, origin: string, filePath: string, movedOut?: true): Panel => ({
  type: 'panel',
  id,
  originProjectId: origin,
  title: `Panel ${id}`,
  kind: PREVIEW_KIND,
  config: { filePath, history: { v: 1, entries: [{ filePath }], index: 0 }, ...(movedOut ? { movedOut } : {}) },
});
const plain = (id: string, origin: string): Panel => ({ type: 'panel', id, originProjectId: origin, title: `Panel ${id}` });
const row = (...children: Panel[]): LayoutNode =>
  children.length === 1 ? children[0]! : { type: 'split', orientation: 'row', children, sizes: children.map(() => 1 / children.length) };
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

interface Stored {
  layout: WorkspaceLayout;
  restored: boolean;
}

function fakeDaemon(projects: Record<string, Stored>, subs: SubWorkspace[]) {
  const state = { projects, subs };
  const writes: Array<{ method: string; params: unknown }> = [];
  const call = <T>(method: string, params?: unknown): Promise<T> => {
    const p = params as { projectId?: string; layout?: WorkspaceLayout; subWorkspaces?: SubWorkspace[] };
    switch (method) {
      case 'projects.list':
        return Promise.resolve({
          projects: Object.keys(state.projects).map((id) => ({ id, name: id, rootFolder: ROOT[id as keyof typeof ROOT] })),
        } as T);
      case 'workspace.load':
        return Promise.resolve(structuredClone(state.projects[p.projectId!]) as T);
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
        return Promise.reject(new Error(`unexpected RPC from the moved-layout walk: ${method}`));
    }
  };
  return { call, writes, state };
}

function deps(daemon: ReturnType<typeof fakeDaemon>, held: { projectIds?: string[]; subWorkspaceIds?: string[] } = {}) {
  const notified: string[] = [];
  return {
    call: daemon.call,
    held: () =>
      Promise.resolve({
        projectIds: new Set(held.projectIds ?? []),
        subWorkspaceIds: new Set(held.subWorkspaceIds ?? []),
      }),
    notifySubWorkspaceChanged: (id: string) => notified.push(id),
    notified,
  };
}

const configOf = (tabs: readonly Tab[], id: string): Record<string, unknown> =>
  (tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === id)?.config ?? {}) as Record<string, unknown>;

/** A cut of `D:/a/x.md` into B, and of folder `D:/a/docs` into B. */
const crossMoves = [
  { from: 'D:/a/x.md', to: 'D:/b/in/x.md' },
  { from: 'D:/a/docs', to: 'D:/b/docs' },
];

describe('walkMovedLayouts over unheld project layouts (R19)', () => {
  it('rewrites editor and preview paths and history; a path leaving the project sets movedOut', async () => {
    const daemon = fakeDaemon(
      {
        A: {
          layout: layoutOf('A', [
            row(editor('e1', 'A', 'D:/a/x.md', ['D:/a/other.md', 'D:/a/x.md']), preview('v1', 'A', 'D:/a/docs/r.md')),
            plain('keep', 'A'),
          ]),
          restored: true,
        },
        B: { layout: layoutOf('B', [plain('b1', 'B')]), restored: true },
      },
      [],
    );

    await walkMovedLayouts(deps(daemon), crossMoves);

    const tabs = daemon.state.projects.A.layout.tabs;
    expect(configOf(tabs, 'e1')).toEqual({
      filePath: 'D:/b/in/x.md',
      history: { v: 1, entries: [{ filePath: 'D:/a/other.md' }, { filePath: 'D:/b/in/x.md' }], index: 1 },
      movedOut: true,
    });
    expect(configOf(tabs, 'v1')).toEqual({
      filePath: 'D:/b/docs/r.md',
      history: { v: 1, entries: [{ filePath: 'D:/b/docs/r.md' }], index: 0 },
      movedOut: true,
    });
    // B's layout had nothing on the moved paths: not written.
    expect(daemon.writes.map((w) => (w.params as { projectId?: string }).projectId)).toEqual(['A']);
  });

  it('a within-project move rewrites the path and sets no flag', async () => {
    const daemon = fakeDaemon({ A: { layout: layoutOf('A', [editor('e1', 'A', 'D:/a/x.md')]), restored: true } }, []);

    await walkMovedLayouts(deps(daemon), [{ from: 'D:/a/x.md', to: 'D:/a/sub/x.md' }]);

    expect(configOf(daemon.state.projects.A.layout.tabs, 'e1')).toEqual({ filePath: 'D:/a/sub/x.md' });
  });

  it('a path an undo brings back inside the project clears the flag', async () => {
    const daemon = fakeDaemon(
      {
        A: {
          layout: layoutOf('A', [row(editor('e1', 'A', 'D:/b/in/x.md', undefined, true), preview('v1', 'A', 'D:/b/docs/r.md', true))]),
          restored: true,
        },
      },
      [],
    );

    await walkMovedLayouts(deps(daemon), [
      { from: 'D:/b/in/x.md', to: 'D:/a/x.md' },
      { from: 'D:/b/docs', to: 'D:/a/docs' },
    ]);

    const tabs = daemon.state.projects.A.layout.tabs;
    expect(configOf(tabs, 'e1')).toEqual({ filePath: 'D:/a/x.md' });
    expect(configOf(tabs, 'v1')).toEqual({
      filePath: 'D:/a/docs/r.md',
      history: { v: 1, entries: [{ filePath: 'D:/a/docs/r.md' }], index: 0 },
    });
  });

  it('the held layout is not written, and a record that did not restore is never written', async () => {
    const daemon = fakeDaemon(
      {
        A: { layout: layoutOf('A', [editor('e1', 'A', 'D:/a/x.md')]), restored: true },
        B: { layout: layoutOf('B', [editor('e2', 'B', 'D:/a/x.md')]), restored: false },
      },
      [],
    );

    await walkMovedLayouts(deps(daemon, { projectIds: ['A'] }), crossMoves);

    expect(daemon.writes).toEqual([]);
    expect(configOf(daemon.state.projects.A.layout.tabs, 'e1')).toEqual({ filePath: 'D:/a/x.md' });
  });

  it('is idempotent: a second walk over the same moves writes nothing', async () => {
    const daemon = fakeDaemon({ A: { layout: layoutOf('A', [editor('e1', 'A', 'D:/a/x.md')]), restored: true } }, []);
    await walkMovedLayouts(deps(daemon), crossMoves);
    const after = daemon.writes.length;

    await walkMovedLayouts(deps(daemon), crossMoves);

    expect(after).toBe(1);
    expect(daemon.writes).toHaveLength(after);
  });
});

describe('the transfer engine triggers the walk once a job’s moves land (T097)', () => {
  it('paste, undo and redo each report exactly the pairs that moved; a copy reports nothing', async () => {
    const landed: MovePair[][] = [];
    const h = await makeHarness({ deps: { afterMoves: (moves) => void landed.push([...moves]) } });
    try {
      await put(join(h.rootA, 'a.txt'), 'a');
      await put(join(h.rootA, 'c.txt'), 'c');
      const from = join(h.rootA, 'a.txt');
      const to = join(h.rootB, 'a.txt');

      await h.svc.paste(1, h.rootB, { mode: 'copy', items: [{ absPath: join(h.rootA, 'c.txt'), projectId: 'A', projectRoot: h.rootA }] }).result;
      expect(landed).toEqual([]);

      const r = await h.svc.paste(1, h.rootB, { mode: 'cut', items: [{ absPath: from, projectId: 'A', projectRoot: h.rootA }] }).result;
      expect(landed).toEqual([[{ from, to }]]);
      // The bracket closed BEFORE the walk was asked for: open editors moved first, layouts after.
      expect(h.bracket.at(-1)).toEqual({ kind: 'moved', moves: [{ from, to }] });

      await h.svc.applyUndo(r.undo!, 'undo');
      await h.svc.applyUndo(r.undo!, 'redo');
      expect(landed.slice(1)).toEqual([[{ from: to, to: from }], [{ from, to }]]);
    } finally {
      await disposeHarness(h);
    }
  });
});

describe('walkMovedLayouts over unheld sub-workspace records (R19)', () => {
  it("judges a synced project panel by ITS project's root, never flags a sub-workspace's own panel, skips the held record", async () => {
    const daemon = fakeDaemon(
      { A: { layout: layoutOf('A', [plain('a', 'A')]), restored: true }, B: { layout: layoutOf('B', [plain('b', 'B')]), restored: true } },
      [
        sub('s1', [row(editor('synced', 'A', 'D:/a/x.md'), editor('own', 'subworkspace:s1', 'D:/a/docs/q.md'))]),
        sub('held', [editor('h1', 'A', 'D:/a/x.md')]),
        sub('untouched', [editor('u1', 'A', 'D:/a/other.md')]),
      ],
    );
    const d = deps(daemon, { subWorkspaceIds: ['held'] });

    await walkMovedLayouts(d, crossMoves);

    const byId = new Map(daemon.state.subs.map((s) => [s.id, s]));
    expect(configOf(byId.get('s1')!.tabs, 'synced')).toEqual({ filePath: 'D:/b/in/x.md', movedOut: true });
    expect(configOf(byId.get('s1')!.tabs, 'own')).toEqual({ filePath: 'D:/b/docs/q.md' });
    expect(configOf(byId.get('held')!.tabs, 'h1')).toEqual({ filePath: 'D:/a/x.md' });
    expect(configOf(byId.get('untouched')!.tabs, 'u1')).toEqual({ filePath: 'D:/a/other.md' });
    expect(daemon.writes.filter((w) => w.method === 'workspace.persistSubWorkspaces')).toHaveLength(1);
    expect(d.notified).toEqual(['s1']);
  });
});
