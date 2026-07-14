import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService, type IUserContext } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  DocumentStateRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { IpcServer } from '../../src/ipc-server.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { ProjectIpcService } from '../../src/project-service.js';
import { DocumentIpcService } from '../../src/document-service.js';

/**
 * `document.*` over the real pipe (016, contracts/document-state-rpc.md).
 *
 * The repository tests prove the STORE. This proves the WIRE: params validated, the owner resolved
 * by the daemon rather than supplied by the client, and every method reachable end to end.
 */
let counter = 0;
function uniquePipeName(): string {
  counter += 1;
  return `\\\\.\\pipe\\throng-document-${process.pid}-${counter}`;
}

const userContext: IUserContext = {
  currentUser: () => ({ userId: 'alice', userName: 'Alice' }),
};

let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let pipeName: string;
let projectId: string;
let projectRoot: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-document-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const projectStore = new ProjectRepository(db);
  const projectService = new ProjectService({
    store: projectStore,
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  const router = new RpcRouter();
  new ProjectIpcService(projectService).register(router);
  new DocumentIpcService(
    new DocumentStateRepository(db),
    userContext,
    (owner, id) => projectStore.getById(owner, id)?.rootFolder ?? null,
  ).register(router);
  pipeName = uniquePipeName();
  server = new IpcServer({ pipeName, startupTimeoutMs: 5000 }, router);
  await server.start();

  // A REAL folder: prune resolves each row against the project root on disk, so a fake path would
  // make every file look deleted.
  projectRoot = join(dataDir, 'proj');
  mkdirSync(projectRoot, { recursive: true });
  const created = await call('projects.create', {
    name: 'Proj',
    colour: '#6aa3ff',
    rootFolder: projectRoot,
  });
  projectId = created.result.project.id;
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

describe('document.* IPC', () => {
  it('round-trips set → get', async () => {
    await call('document.setState', { projectId, relPath: 'src/main.rs', languageId: 'python' });
    const got = await call('document.getState', { projectId, relPath: 'src/main.rs' });
    expect(got.result.state).toEqual({
      projectId,
      relPath: 'src/main.rs',
      languageId: 'python',
    });
  });

  it('returns null for a document with no override — never an error', async () => {
    const got = await call('document.getState', { projectId, relPath: 'nothing/here.txt' });
    expect(got.result.state).toBeNull();
    expect(got.error).toBeUndefined();
  });

  it('deletes the row when languageId is null', async () => {
    await call('document.setState', { projectId, relPath: 'a.rs', languageId: 'go' });
    await call('document.setState', { projectId, relPath: 'a.rs', languageId: null });
    const got = await call('document.getState', { projectId, relPath: 'a.rs' });
    expect(got.result.state).toBeNull();
  });

  it('stores `plaintext` as a REAL row rather than collapsing it to null (FR-004c)', async () => {
    await call('document.setState', { projectId, relPath: 'a.rs', languageId: 'plaintext' });
    const got = await call('document.getState', { projectId, relPath: 'a.rs' });
    expect(got.result.state.languageId).toBe('plaintext');
  });

  it('round-trips a STALE id unchanged (FR-005b)', async () => {
    // The daemon is not the arbiter of which languages exist. Validating here would erase a user's
    // choice the moment a language was renamed or temporarily removed.
    await call('document.setState', { projectId, relPath: 'a.zz', languageId: 'elvish' });
    const got = await call('document.getState', { projectId, relPath: 'a.zz' });
    expect(got.result.state.languageId).toBe('elvish');
  });

  it('carries the row with the file across a rename (SC-013a)', async () => {
    await call('document.setState', { projectId, relPath: 'old.txt', languageId: 'sql' });
    const moved = await call('document.movePath', {
      projectId,
      fromRelPath: 'old.txt',
      toRelPath: 'new.txt',
    });
    expect(moved.result.moved).toBe(true);

    expect((await call('document.getState', { projectId, relPath: 'old.txt' })).result.state).toBeNull();
    expect(
      (await call('document.getState', { projectId, relPath: 'new.txt' })).result.state.languageId,
    ).toBe('sql');
  });

  it('reports moved:false for a file with no override — the common case, not an error', async () => {
    const moved = await call('document.movePath', {
      projectId,
      fromRelPath: 'plain.txt',
      toRelPath: 'renamed.txt',
    });
    expect(moved.error).toBeUndefined();
    expect(moved.result.moved).toBe(false);
  });

  it('prunes only rows whose file is gone', async () => {
    // 'kept.rs' exists on disk; 'gone.rs' never did. The daemon checks each ROW against the
    // project folder, so the client does not have to enumerate the tree — and cannot get it wrong.
    writeFileSync(join(projectRoot, 'kept.rs'), 'fn main() {}', 'utf8');
    await call('document.setState', { projectId, relPath: 'kept.rs', languageId: 'rust' });
    await call('document.setState', { projectId, relPath: 'gone.rs', languageId: 'go' });

    const pruned = await call('document.pruneMissing', { projectId });
    expect(pruned.result.pruned).toBe(1);
    expect((await call('document.getState', { projectId, relPath: 'kept.rs' })).result.state).not.toBeNull();
    expect((await call('document.getState', { projectId, relPath: 'gone.rs' })).result.state).toBeNull();
  });

  it('CASCADES: deleting the project takes its document rows with it', async () => {
    await call('document.setState', { projectId, relPath: 'a.txt', languageId: 'sql' });
    await call('projects.delete', { id: projectId });
    const got = await call('document.getState', { projectId, relPath: 'a.txt' });
    expect(got.result.state).toBeNull();
  });

  it('rejects malformed params rather than guessing', async () => {
    const bad = await call('document.setState', { projectId, languageId: 'go' }); // no relPath
    expect(bad.error).toBeDefined();
    expect(bad.error.code).toBe(-32602);
  });
});
