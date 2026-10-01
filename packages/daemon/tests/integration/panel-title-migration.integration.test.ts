import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectService,
  collectPanels,
  panelDisplayTitle,
  type IUserContext,
  type LayoutNode,
  type SubWorkspace,
  type WorkspaceLayout,
} from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  WorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { ProjectIpcService } from '../../src/project-service.js';
import { WorkspaceIpcService } from '../../src/workspace-service.js';

/**
 * 048 T042 (FR-034, FR-035, SC-008) — an alpha8 layout carrying custom panel titles loads through the
 * daemon path without error, shows each panel by its derived title, and re-saves without the two
 * removed fields.
 *
 * Integration, not unit: the unit test of `dropCustomPanelTitles` proves the transform; what it cannot
 * prove is that the document which comes OUT of a real `workspace_layout` row, over the real pipe, is
 * the migrated one — and that what goes back IN is clean. The legacy document is written straight
 * through the repository, exactly as an alpha8 daemon left it, bypassing the service under test.
 */
let counter = 0;
function uniquePipeName(): string {
  counter += 1;
  return `\\\\.\\pipe\\throng-title-migration-${process.pid}-${counter}`;
}

const OWNER = 'alice';
const userContext: IUserContext = { currentUser: () => ({ userId: OWNER, userName: 'Alice' }) };

let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let pipeName: string;
let projectService: ProjectService;
let workspaceStore: WorkspaceRepository;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-title-migration-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const projectStore = new ProjectRepository(db);
  workspaceStore = new WorkspaceRepository(db);
  projectService = new ProjectService({
    store: projectStore,
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  const router = new RpcRouter();
  new ProjectIpcService(projectService).register(router);
  new WorkspaceIpcService({ workspaceStore, projectStore, userContext }).register(router);
  pipeName = uniquePipeName();
  server = new IpcServer({ pipeName }, router);
  await server.start();
});

afterEach(async () => {
  await server.stop();
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let rpcId = 0;
function call(method: string, params: unknown): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })}\n`),
    );
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

/** A panel as an alpha8 daemon persisted it — the two pre-048 fields included. */
const legacyPanel = (id: string, projectId: string, over: Record<string, unknown> = {}): LayoutNode =>
  ({ type: 'panel', id, originProjectId: projectId, title: id, ...over }) as unknown as LayoutNode;

function alpha8Layout(projectId: string): WorkspaceLayout {
  return {
    projectId,
    schemaVersion: 3,
    activeTabId: 't1',
    tabs: [
      {
        id: 't1',
        title: 'Tab 1',
        activePanelId: 'p2',
        root: {
          type: 'split',
          orientation: 'row',
          sizes: [0.35, 0.65],
          children: [
            legacyPanel('p1', projectId, { title: 'Panel 1' }),
            legacyPanel('p2', projectId, { title: 'My Build', titleIsCustom: true, defaultTitle: 'Panel 2' }),
          ],
        },
      },
    ],
  };
}

const rawPanels = (layout: WorkspaceLayout): Record<string, unknown>[] =>
  layout.tabs.flatMap((t) => collectPanels(t.root)) as unknown as Record<string, unknown>[];

function makeProject(): string {
  return projectService.create({ name: 'P', colour: '#6aa3ff', rootFolder: 'C:/p' }).id;
}

describe('an alpha8 layout with custom panel titles (048 FR-035)', () => {
  it('loads through workspace.load without error, with derived titles and ids unchanged', async () => {
    const projectId = makeProject();
    workspaceStore.save(OWNER, projectId, alpha8Layout(projectId));

    const res = await call('workspace.load', { projectId });
    expect(res.error).toBeUndefined();
    expect(res.result.restored).toBe(true);
    const layout = res.result.layout as WorkspaceLayout;
    const panels = collectPanels(layout.tabs[0].root);
    expect(panels.map((p) => p.id)).toEqual(['p1', 'p2']); // FR-034
    // FR-128: the legacy generated titles retire to "Blank Panel"; the startup reconcile numbers them.
    expect(panels.map((p) => panelDisplayTitle(p))).toEqual(['Blank Panel', 'Blank Panel']);
    for (const p of rawPanels(layout)) {
      expect(p).not.toHaveProperty('titleIsCustom');
      expect(p).not.toHaveProperty('defaultTitle');
    }
    expect(layout.tabs[0].root).toMatchObject({ orientation: 'row', sizes: [0.35, 0.65] });
  });

  it('re-saves without the two fields — and a save still carrying them is cleaned on the way in', async () => {
    const projectId = makeProject();
    workspaceStore.save(OWNER, projectId, alpha8Layout(projectId));

    const loaded = (await call('workspace.load', { projectId })).result.layout as WorkspaceLayout;
    expect((await call('workspace.save', { projectId, layout: loaded })).result.ok).toBe(true);
    expect(rawPanels(workspaceStore.load(OWNER, projectId).layout).map((p) => Object.keys(p).sort())).toEqual([
      ['id', 'originProjectId', 'title', 'type'],
      ['id', 'originProjectId', 'title', 'type'],
    ]);

    // A window that still held the pre-048 document writes it back: the daemon strips it.
    expect((await call('workspace.save', { projectId, layout: alpha8Layout(projectId) })).result.ok).toBe(true);
    const stored = rawPanels(workspaceStore.load(OWNER, projectId).layout);
    expect(stored.find((p) => p.id === 'p2')).toEqual({ type: 'panel', id: 'p2', originProjectId: projectId, title: 'Blank Panel' });
  });

  it('is idempotent across loads — a second load returns the same document', async () => {
    const projectId = makeProject();
    workspaceStore.save(OWNER, projectId, alpha8Layout(projectId));
    const first = (await call('workspace.load', { projectId })).result.layout as WorkspaceLayout;
    const second = (await call('workspace.load', { projectId })).result.layout as WorkspaceLayout;
    expect(second).toEqual(first);
  });

  it('migrates a sub-workspace (tear-off) on workspace.loadSubWorkspaces', async () => {
    const projectId = makeProject();
    const sub = {
      id: 'sub-1',
      ownerUser: OWNER,
      name: 'Blue',
      colour: '#3355ff',
      bounds: { x: 10, y: 10, width: 800, height: 600 },
      activeTabId: 'st1',
      tabs: [
        {
          id: 'st1',
          title: 'Tab 1',
          root: legacyPanel('p7', projectId, { title: 'Scratch', titleIsCustom: true, defaultTitle: 'Panel 7' }),
        },
      ],
    } as unknown as SubWorkspace;
    workspaceStore.persistSubWorkspaces(OWNER, [sub]);

    const res = await call('workspace.loadSubWorkspaces', {});
    expect(res.error).toBeUndefined();
    const subs = res.result.subWorkspaces as SubWorkspace[];
    const root = subs.find((s) => s.id === 'sub-1')?.tabs[0].root;
    expect(root).toEqual({ type: 'panel', id: 'p7', originProjectId: projectId, title: 'Blank Panel' });
  });
});
