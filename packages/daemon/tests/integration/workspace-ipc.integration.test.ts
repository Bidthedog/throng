import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectService,
  addPanel,
  type IUserContext,
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

let counter = 0;
function uniquePipeName(): string {
  counter += 1;
  return `\\\\.\\pipe\\throng-workspace-${process.pid}-${counter}`;
}

const userContext: IUserContext = {
  currentUser: () => ({ userId: 'alice', userName: 'Alice' }),
};

let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let pipeName: string;
let projectService: ProjectService;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-workspace-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const projectStore = new ProjectRepository(db);
  const workspaceStore = new WorkspaceRepository(db);
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
  server = new IpcServer({ pipeName, startupTimeoutMs: 5000 }, router);
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

function makeProject(): string {
  return projectService.create({ name: 'P', colour: '#6aa3ff', rootFolder: 'C:/p' }).id;
}

describe('workspace.* IPC', () => {
  it('returns the default empty workspace for a project with no saved layout', async () => {
    const projectId = makeProject();
    const res = await call('workspace.load', { projectId });
    expect(res.result.restored).toBe(false);
    expect(res.result.layout.tabs).toHaveLength(1);
    expect(res.result.layout.projectId).toBe(projectId);
  });

  it('round-trips a saved layout (restored: true)', async () => {
    const projectId = makeProject();
    const loaded = (await call('workspace.load', { projectId })).result.layout as WorkspaceLayout;
    // Add a panel and save.
    const tabId = loaded.tabs[0].id;
    const modified = addPanel(loaded, tabId, randomUUID());
    const saved = await call('workspace.save', { projectId, layout: modified });
    expect(saved.result.ok).toBe(true);

    const reloaded = await call('workspace.load', { projectId });
    expect(reloaded.result.restored).toBe(true);
    expect(reloaded.result.layout.tabs[0].root.type).toBe('split');
  });

  it('rejects a layout that mixes another project’s Panel (INV-4) with -32602', async () => {
    const projectId = makeProject();
    const loaded = (await call('workspace.load', { projectId })).result.layout as WorkspaceLayout;
    // Corrupt: a panel whose originProjectId differs from the project.
    const bad: WorkspaceLayout = {
      ...loaded,
      tabs: [
        {
          ...loaded.tabs[0],
          root: { type: 'panel', id: 'x', originProjectId: 'someone-else', title: 'X' },
        },
      ],
    };
    const res = await call('workspace.save', { projectId, layout: bad });
    expect(res.error.code).toBe(-32602);
  });

  it('rejects a structurally malformed layout with -32602 (not an internal error)', async () => {
    const projectId = makeProject();
    // A tab whose root is missing entirely — validation must not throw -32603.
    const malformed = {
      projectId,
      schemaVersion: 1,
      activeTabId: 't1',
      tabs: [{ id: 't1', title: 'Tab 1' }],
    };
    const res = await call('workspace.save', { projectId, layout: malformed });
    expect(res.error.code).toBe(-32602);
  });

  it('returns -32004 for workspace.load of an unknown project', async () => {
    const res = await call('workspace.load', { projectId: 'does-not-exist' });
    expect(res.error.code).toBe(-32004);
  });

  it('round-trips sub-workspaces', async () => {
    const projectId = makeProject();
    const subs = [
      {
        id: 'sw1',
        ownerUser: 'alice',
        name: 'Detached 1',
        colour: '#8a8f98',
        bounds: { x: 10, y: 20, width: 800, height: 600, displayId: 'd1' },
        tabs: [
          {
            id: 't-sw',
            title: 'Detached',
            root: { type: 'panel', id: 'pp', originProjectId: projectId, title: 'PP' },
          },
        ],
      },
    ];
    const persisted = await call('workspace.persistSubWorkspaces', { subWorkspaces: subs });
    expect(persisted.result.ok).toBe(true);

    const loaded = await call('workspace.loadSubWorkspaces', {});
    expect(loaded.result.subWorkspaces).toHaveLength(1);
    expect(loaded.result.subWorkspaces[0].bounds.displayId).toBe('d1');
  });
});
