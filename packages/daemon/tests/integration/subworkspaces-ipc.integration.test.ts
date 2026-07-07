import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService, type IUserContext } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  WorkspaceRepository,
  SubWorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { ProjectIpcService } from '../../src/project-service.js';
import { WorkspaceIpcService } from '../../src/workspace-service.js';
import { SubWorkspaceIpcService } from '../../src/subworkspace-service.js';

let counter = 0;
const uniquePipeName = (): string => `\\\\.\\pipe\\throng-subws-${process.pid}-${(counter += 1)}`;
const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };

let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let pipeName: string;
let projectId: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-subws-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const projectStore = new ProjectRepository(db);
  const workspaceStore = new WorkspaceRepository(db);
  const subWorkspaceStore = new SubWorkspaceRepository(db);
  const projectService = new ProjectService({
    store: projectStore,
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  projectId = projectService.create({ name: 'P', colour: '#6aa3ff', rootFolder: 'C:/p' }).id;
  const router = new RpcRouter();
  new ProjectIpcService(projectService).register(router);
  new WorkspaceIpcService({ workspaceStore, projectStore, userContext }).register(router);
  new SubWorkspaceIpcService({ store: subWorkspaceStore, userContext }).register(router);
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
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, nl)));
      } catch (e) {
        reject(e);
      } finally {
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

function seedSub(id: string, name: string, colour: string): unknown {
  return {
    id,
    ownerUser: 'alice',
    name,
    colour,
    bounds: { x: 1, y: 2, width: 300, height: 200 },
    tabs: [{ id: `${id}-t`, title: 'D', root: { type: 'panel', id: `${id}-p`, originProjectId: projectId, title: 'P' } }],
  };
}

describe('subworkspace.* IPC', () => {
  it('lists, renames, recolours and deletes sub-workspaces (persisted)', async () => {
    await call('workspace.persistSubWorkspaces', {
      subWorkspaces: [seedSub('s1', 'Alpha', '#ffffff'), seedSub('s2', 'Beta', '#000000')],
    });

    const listed = await call('subworkspace.list', {});
    expect(listed.result.subWorkspaces).toEqual([
      { id: 's1', name: 'Alpha', colour: '#ffffff', tabCount: 1, panelCount: 1 },
      { id: 's2', name: 'Beta', colour: '#000000', tabCount: 1, panelCount: 1 },
    ]);

    expect((await call('subworkspace.rename', { id: 's1', name: 'Renamed' })).result.ok).toBe(true);
    expect((await call('subworkspace.recolour', { id: 's1', colour: '#123456' })).result.ok).toBe(true);
    expect((await call('subworkspace.delete', { id: 's2' })).result.ok).toBe(true);

    const after = await call('subworkspace.list', {});
    expect(after.result.subWorkspaces).toEqual([
      { id: 's1', name: 'Renamed', colour: '#123456', tabCount: 1, panelCount: 1 },
    ]);
  });

  it('rejects an empty rename with -32602', async () => {
    await call('workspace.persistSubWorkspaces', { subWorkspaces: [seedSub('s1', 'Alpha', '#fff')] });
    const res = await call('subworkspace.rename', { id: 's1', name: '   ' });
    expect(res.error.code).toBe(-32602);
  });
});
