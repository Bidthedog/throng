/**
 * 052 R2, R3 — `workspace.followMoves` rewrites every layout no window holds, in one daemon turn, and the
 * per-record sub-workspace writes never put back a stale sibling.
 *
 * Layer: integration — atomicity is a property of the daemon's single event loop plus a real SQLite
 * transaction; no in-memory fake shows either.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDITOR_KIND,
  PREVIEW_KIND,
  ProjectService,
  type IUserContext,
  type IWorkspaceStore,
  type LayoutNode,
  type Panel,
  type SubWorkspace,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  WorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { RpcRouter } from '../../src/rpc-router.js';
import { WorkspaceIpcService } from '../../src/workspace-service.js';

const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };
const ROOT = 'C:/p';
const OLD = 'C:/p/a.md';
const NEW = 'C:/p/b.md';
const RENAME = [{ from: OLD, to: NEW }];

let db: ThrongDatabase;
let dataDir: string;
let store: WorkspaceRepository;
let projects: ProjectService;
let router: RpcRouter;
let rpcId = 0;

function wire(workspaceStore: IWorkspaceStore): void {
  router = new RpcRouter();
  new WorkspaceIpcService({ workspaceStore, projectStore: new ProjectRepository(db), userContext }).register(router);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-follow-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  store = new WorkspaceRepository(db);
  projects = new ProjectService({
    store: new ProjectRepository(db),
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  wire(store);
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function call<T = Record<string, any>>(method: string, params: unknown): Promise<T> {
  const res = await router.handle({ jsonrpc: '2.0', id: ++rpcId, method, params });
  if ('error' in res && res.error) throw new Error(`${method}: ${res.error.message}`);
  return (res as { result: T }).result;
}

const editor = (projectId: string, id: string, filePath: string): Panel => ({
  type: 'panel',
  id,
  originProjectId: projectId,
  title: id,
  kind: EDITOR_KIND,
  config: { filePath, history: { v: 1, entries: [{ filePath }], index: 0 } },
});
const preview = (projectId: string, id: string, filePath: string): Panel => ({
  ...editor(projectId, id, filePath),
  kind: PREVIEW_KIND,
});
const row = (...children: Panel[]): LayoutNode => ({
  type: 'split',
  orientation: 'row',
  children,
  sizes: children.map(() => 1 / children.length),
});
const tabOf = (id: string, root: LayoutNode): Tab => ({ id, title: id, root, activePanelId: (root.type === 'panel' ? root : (root.children[0] as Panel)).id });

// Project roots may not overlap: the first project owns `C:/p` (where the moved files live); every other one has a
// root of its own, so for its panels the same move is a move OUT of their project (050 FR-035) — paths still follow.
let seeded = 0;
beforeEach(() => {
  seeded = 0;
});

function seedProject(filePath = OLD): string {
  const rootFolder = seeded === 0 ? ROOT : `C:/q${seeded}`;
  seeded += 1;
  const projectId = projects.create({ name: 'P', colour: '#6aa3ff', rootFolder }).id;
  const layout: WorkspaceLayout = {
    projectId,
    schemaVersion: 3,
    tabs: [tabOf(`${projectId}-t`, row(editor(projectId, `${projectId}-e`, filePath), preview(projectId, `${projectId}-v`, filePath === OLD ? 'C:/p/c.md' : filePath)))],
    activeTabId: `${projectId}-t`,
  } as WorkspaceLayout;
  store.save('alice', projectId, layout);
  return projectId;
}

function seedSub(id: string, projectId: string, filePath = OLD): SubWorkspace {
  const sub: SubWorkspace = {
    id,
    ownerUser: 'alice',
    name: id,
    colour: '#ffffff',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    tabs: [tabOf(`${id}-t`, row(editor(projectId, `${id}-e`, filePath), preview(projectId, `${id}-v`, filePath)))],
  };
  store.saveSubWorkspace('alice', sub);
  return sub;
}

const rawLayout = (projectId: string): string | undefined =>
  (db.prepare(`SELECT layout_json FROM workspace_layout WHERE project_id = ?`).get(projectId) as { layout_json: string } | undefined)
    ?.layout_json;
const rawSub = (id: string): { content_json: string; updated_at: string } =>
  db.prepare(`SELECT content_json, updated_at FROM sub_workspaces WHERE id = ?`).get(id) as { content_json: string; updated_at: string };
const layoutUpdatedAt = (projectId: string): string =>
  (db.prepare(`SELECT updated_at FROM workspace_layout WHERE project_id = ?`).get(projectId) as { updated_at: string }).updated_at;
const noHeld = { projectIds: [], subWorkspaceIds: [] };
// The repository canonicalises stored paths to the host separator (#229), so compare on identity.
const has = (json: string | undefined, path: string): boolean =>
  json !== undefined && json.replace(/\\\\/g, '/').includes(path);

describe('workspace.followMoves', () => {
  it('rewrites editor, preview and history paths in every unheld project and sub-workspace (SC-001)', async () => {
    const p1 = seedProject();
    const p2 = seedProject();
    seedSub('s1', p1);
    seedSub('s2', p2);

    const result = await call('workspace.followMoves', { moves: RENAME, held: noHeld });

    expect(new Set(result.changedProjectIds)).toEqual(new Set([p1, p2]));
    expect(new Set(result.changedSubWorkspaceIds)).toEqual(new Set(['s1', 's2']));
    expect(result.skipped).toBe(0);
    for (const json of [rawLayout(p1), rawLayout(p2), rawSub('s1').content_json, rawSub('s2').content_json]) {
      expect(has(json, OLD)).toBe(false);
      expect(has(json, NEW)).toBe(true);
    }
    // A move inside a panel's own project is not a move out.
    expect(rawLayout(p1)).not.toContain('movedOut');
  });

  it('leaves held records alone', async () => {
    const p1 = seedProject();
    seedSub('s1', p1);
    const before = { layout: rawLayout(p1), sub: rawSub('s1') };

    const result = await call('workspace.followMoves', { moves: RENAME, held: { projectIds: [p1], subWorkspaceIds: ['s1'] } });

    expect(result).toEqual({ changedProjectIds: [], changedSubWorkspaceIds: [], skipped: 0 });
    expect(rawLayout(p1)).toBe(before.layout);
    expect(rawSub('s1')).toEqual(before.sub);
  });

  it('`only` restricts the walk to the named records, whatever `held` says (R4)', async () => {
    const p1 = seedProject();
    const p2 = seedProject();
    const result = await call('workspace.followMoves', {
      moves: RENAME,
      held: { projectIds: [p1], subWorkspaceIds: [] },
      only: { projectIds: [p1] },
    });
    expect(result.changedProjectIds).toEqual([p1]);
    expect(has(rawLayout(p2), OLD)).toBe(true);
  });

  it('does not write a record no moved path appears in (FR-004), and a second identical call writes nothing', async () => {
    const untouched = seedProject('C:/p/other.md');
    const touched = seedProject();
    const stamp = layoutUpdatedAt(untouched);

    await call('workspace.followMoves', { moves: RENAME, held: noHeld });
    expect(layoutUpdatedAt(untouched)).toBe(stamp);

    const after = rawLayout(touched);
    const again = await call('workspace.followMoves', { moves: RENAME, held: noHeld });
    expect(again).toEqual({ changedProjectIds: [], changedSubWorkspaceIds: [], skipped: 0 });
    expect(rawLayout(touched)).toBe(after);
  });

  it('ends at the path the file actually has across rename, undo and redo (Story 1 scenario 4)', async () => {
    const p1 = seedProject();
    for (const moves of [RENAME, [{ from: NEW, to: OLD }], RENAME]) {
      await call('workspace.followMoves', { moves, held: noHeld });
      const at = moves[0]!.to;
      expect(has(rawLayout(p1), at)).toBe(true);
      expect(has(rawLayout(p1), moves[0]!.from)).toBe(false);
    }
  });

  it('skips a corrupt record unchanged and counts it (FR-009)', async () => {
    const good = seedProject();
    const bad = seedProject();
    db.prepare(`UPDATE workspace_layout SET layout_json = '{not json' WHERE project_id = ?`).run(bad);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await call('workspace.followMoves', { moves: RENAME, held: noHeld });

    expect(result.changedProjectIds).toEqual([good]);
    expect(result.skipped).toBe(1);
    expect(rawLayout(bad)).toBe('{not json');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a record whose write throws is left unchanged; the others are written; nothing is thrown (FR-009)', async () => {
    const p1 = seedProject();
    const p2 = seedProject();
    const before = rawLayout(p2);
    const failing: IWorkspaceStore = Object.assign(Object.create(store) as WorkspaceRepository, {
      save: (owner: string, projectId: string, layout: WorkspaceLayout) => {
        if (projectId === p2) throw new Error('disk full');
        store.save(owner, projectId, layout);
      },
    });
    wire(failing);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await call('workspace.followMoves', { moves: RENAME, held: noHeld });

    expect(result.changedProjectIds).toEqual([p1]);
    expect(result.skipped).toBe(1);
    expect(rawLayout(p2)).toBe(before);
    expect(has(rawLayout(p1), NEW)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('counts and logs a corrupt sub-workspace row, leaving it unchanged (FR-009, T026)', async () => {
    const p1 = seedProject();
    seedSub('good', p1);
    seedSub('bad', p1);
    db.prepare(`UPDATE sub_workspaces SET content_json = '{not json' WHERE id = 'bad'`).run();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await call('workspace.followMoves', { moves: RENAME, held: noHeld });

    expect(result.changedSubWorkspaceIds).toEqual(['good']);
    expect(result.skipped).toBe(1);
    expect(rawSub('bad').content_json).toBe('{not json');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('sub-workspace bad');
  });

  it('a workspace.save of an unheld project in flight with followMoves keeps both (FR-005, T027)', async () => {
    const p1 = seedProject();
    const loaded = (await call<{ layout: WorkspaceLayout }>('workspace.load', { projectId: p1 })).layout;
    const renamedTab = { ...loaded, tabs: loaded.tabs.map((t) => ({ ...t, title: 'renamed tab' })) };
    // The save lands first or second; either way one write builds on the other, never over it.
    await Promise.all([
      call('workspace.save', { projectId: p1, layout: renamedTab }),
      call('workspace.followMoves', { moves: RENAME, held: noHeld }),
    ]);
    // The walk never erases a window's change: it reads the record as it stands when it runs. (A save built before
    // the move that lands after the walk carries the old path back — R4's scoped follow, `workspace-store`'s job.)
    expect(rawLayout(p1)).toContain('renamed tab');
  });

  it('never writes a project that has no saved layout (saving would persist the synthesised default)', async () => {
    const neverSaved = projects.create({ name: 'N', colour: '#6aa3ff', rootFolder: 'C:/never' }).id;
    const result = await call('workspace.followMoves', { moves: RENAME, held: noHeld });
    expect(result.changedProjectIds).not.toContain(neverSaved);
    expect(result.skipped).toBe(0);
    expect(rawLayout(neverSaved)).toBeUndefined();
  });

  it('marks a panel whose file leaves its project as moved out (050 FR-035)', async () => {
    const p1 = seedProject();
    await call('workspace.followMoves', { moves: [{ from: OLD, to: 'D:/elsewhere/a.md' }], held: noHeld });
    expect(rawLayout(p1)).toContain('"movedOut":true');
  });

  it('50 records complete inside 051 FR-021\'s 100 ms service bound (SC-005)', async () => {
    const first = seedProject();
    for (let i = 0; i < 25; i += 1) seedProject();
    for (let i = 0; i < 24; i += 1) seedSub(`s${i}`, first);

    const started = performance.now();
    const result = await call('workspace.followMoves', { moves: RENAME, held: noHeld });
    const elapsed = performance.now() - started;

    console.info(`[052 SC-005] followMoves over 50 records: ${elapsed.toFixed(1)} ms`);
    expect(result.changedProjectIds.length + result.changedSubWorkspaceIds.length).toBe(50);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('workspace.saveSubWorkspace / deleteSubWorkspaces', () => {
  it('write one record and leave siblings alone', async () => {
    const p1 = seedProject();
    seedSub('s1', p1);
    seedSub('s2', p1);
    const s2Before = rawSub('s2');

    await call('workspace.saveSubWorkspace', { subWorkspace: { ...seedSub('s1', p1), name: 'renamed' } });
    expect(rawSub('s2')).toEqual(s2Before);

    const deleted = await call('workspace.deleteSubWorkspaces', { ids: ['s1', 'missing'] });
    expect(deleted).toEqual({ ok: true, deleted: ['s1'] });
    expect(rawSub('s2')).toEqual(s2Before);
  });

  // SC-003 / FR-005 — the race the per-record write exists for: a closed record's rewrite and an open
  // sub-workspace's own save, in flight together, 50 times. Neither may undo the other.
  it('50 alternating rename cycles racing an open sub-workspace save lose neither write (SC-003)', async () => {
    const p1 = seedProject();
    seedSub('closed', p1, 'C:/p/f0.md');
    const open = seedSub('open', p1, 'C:/p/mine.md');

    for (let i = 0; i < 50; i += 1) {
      const moves = [{ from: `C:/p/f${i}.md`, to: `C:/p/f${i + 1}.md` }];
      const openNow: SubWorkspace = { ...open, name: `open-${i}` };
      await Promise.all([
        call('workspace.followMoves', { moves, held: { projectIds: [p1], subWorkspaceIds: ['open'] } }),
        call('workspace.saveSubWorkspace', { subWorkspace: openNow }),
      ]);
      const subs = store.loadSubWorkspaces('alice');
      expect(has(JSON.stringify(subs.find((s) => s.id === 'closed')!.tabs), `C:/p/f${i + 1}.md`)).toBe(true);
      expect(subs.find((s) => s.id === 'open')!.name).toBe(`open-${i}`);
    }
  });
});
