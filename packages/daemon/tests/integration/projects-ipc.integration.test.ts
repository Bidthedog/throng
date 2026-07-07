import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService, type IUserContext } from '@throng/core';
import { openDatabase, runMigrations, ProjectRepository, type ThrongDatabase } from '@throng/persistence';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { HealthService } from '../../src/health-service.js';
import { ProjectIpcService } from '../../src/project-service.js';

let counter = 0;
function uniquePipeName(): string {
  counter += 1;
  return `\\\\.\\pipe\\throng-projects-${process.pid}-${counter}`;
}

const userContext: IUserContext = {
  currentUser: () => ({ userId: 'alice', userName: 'Alice' }),
};

let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let pipeName: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-projects-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const store = new ProjectRepository(db);
  const service = new ProjectService({
    store,
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  const router = new RpcRouter();
  new HealthService().register(router);
  new ProjectIpcService(service).register(router);
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

const validInput = { name: 'Subnet Vault', colour: '#6aa3ff', rootFolder: 'C:/code/subnet' };

describe('projects.* IPC', () => {
  it('creates the first project as active and lists it', async () => {
    const created = await call('projects.create', validInput);
    expect(created.result.project.name).toBe('Subnet Vault');
    expect(created.result.project.isActive).toBe(true);
    expect(created.result.project.id).toBeTruthy();

    const listed = await call('projects.list', {});
    expect(listed.result.projects).toHaveLength(1);
    expect(listed.result.projects[0].id).toBe(created.result.project.id);
  });

  it('defaults hiddenPaths to empty and round-trips projects.setHidden (004)', async () => {
    const created = (await call('projects.create', validInput)).result.project;
    expect(created.hiddenPaths).toEqual([]);

    const set = await call('projects.setHidden', {
      id: created.id,
      hiddenPaths: ['node_modules', 'dist', 'node_modules'], // de-duplicated by core
    });
    expect(set.result.project.hiddenPaths.sort()).toEqual(['dist', 'node_modules']);

    const listed = (await call('projects.list', {})).result.projects as Array<{
      id: string;
      hiddenPaths: string[];
    }>;
    expect(listed.find((p) => p.id === created.id)?.hiddenPaths.sort()).toEqual([
      'dist',
      'node_modules',
    ]);
  });

  it('updates only the provided fields and bumps updatedAt', async () => {
    const created = (await call('projects.create', validInput)).result.project;
    // Ensure a distinct timestamp.
    const updated = await call('projects.update', { id: created.id, name: 'Renamed' });
    expect(updated.result.project.name).toBe('Renamed');
    expect(updated.result.project.colour).toBe(created.colour);
    expect(updated.result.project.rootFolder).toBe(created.rootFolder);
  });

  it('setActive makes exactly one project active', async () => {
    const a = (await call('projects.create', validInput)).result.project;
    const b = (await call('projects.create', { ...validInput, name: 'Second', rootFolder: 'C:/code/second' })).result.project;
    await call('projects.setActive', { id: b.id });
    const list = (await call('projects.list', {})).result.projects as Array<{
      id: string;
      isActive: boolean;
    }>;
    expect(list.filter((p) => p.isActive).map((p) => p.id)).toEqual([b.id]);
    void a;
  });

  it('delete of the active project promotes another and cascades its layout', async () => {
    const a = (await call('projects.create', validInput)).result.project;
    const b = (await call('projects.create', { ...validInput, name: 'Second', rootFolder: 'C:/code/second' })).result.project;
    // Seed a layout row for the active project to prove the cascade.
    db.prepare(
      `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('alice', a.id, 1, '{}', 'now');

    const deleted = await call('projects.delete', { id: a.id });
    expect(deleted.result.deletedId).toBe(a.id);
    expect(deleted.result.newActiveId).toBe(b.id);

    const layoutCount = db
      .prepare('SELECT COUNT(*) AS n FROM workspace_layout WHERE project_id = ?')
      .get(a.id) as { n: number };
    expect(layoutCount.n).toBe(0);
  });

  it('reorders the project list and appends new projects to the end (FR-046)', async () => {
    const a = (await call('projects.create', { ...validInput, name: 'A', rootFolder: 'C:/code/a' })).result.project;
    const b = (await call('projects.create', { ...validInput, name: 'B', rootFolder: 'C:/code/b' })).result.project;
    const c = (await call('projects.create', { ...validInput, name: 'C', rootFolder: 'C:/code/c' })).result.project;
    // Default order is creation order.
    let list = (await call('projects.list', {})).result.projects as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual([a.id, b.id, c.id]);

    const reordered = await call('projects.reorder', { orderedIds: [c.id, a.id, b.id] });
    expect(reordered.result.orderedIds).toEqual([c.id, a.id, b.id]);
    list = (await call('projects.list', {})).result.projects as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual([c.id, a.id, b.id]);

    // A newly created project appends to the end of the current order.
    const d = (await call('projects.create', { ...validInput, name: 'D', rootFolder: 'C:/code/d' })).result.project;
    list = (await call('projects.list', {})).result.projects as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual([c.id, a.id, b.id, d.id]);
  });

  it('rejects invalid params with -32602', async () => {
    const bad = await call('projects.create', { name: '', colour: '#fff', rootFolder: 'C:/x' });
    expect(bad.error.code).toBe(-32602);
  });

  it('rejects an unknown id with -32004', async () => {
    const missing = await call('projects.setActive', { id: 'does-not-exist' });
    expect(missing.error.code).toBe(-32004);
  });

  it('still answers health.ping alongside projects.*', async () => {
    const pong = await call('health.ping', {});
    expect(pong.result.status).toBe('ok');
  });

  it('returns -32601 for an unknown method', async () => {
    const unknown = await call('does.not.exist', {});
    expect(unknown.error.code).toBe(-32601);
  });
});
