import { resolveIpcAddress } from '@throng/core';
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
  server = new IpcServer({ pipeName }, router);
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
    const socket = connect(resolveIpcAddress(pipeName));
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
      // 073 FR-040 — the second leaf of the row, empty here.
      gridColumnWidths: null,
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

  it('carries the rows of the files inside a renamed folder (#471)', async () => {
    await call('document.setState', { projectId, relPath: 'folder/a.txt', languageId: 'sql' });
    const moved = await call('document.movePath', {
      projectId,
      fromRelPath: 'folder',
      toRelPath: 'folder2',
    });
    expect(moved.result.moved).toBe(true);
    expect(
      (await call('document.getState', { projectId, relPath: 'folder2/a.txt' })).result.state.languageId,
    ).toBe('sql');
  });

  it('refuses a move INTO a project the owner does not have', async () => {
    await call('document.setState', { projectId, relPath: 'x.txt', languageId: 'sql' });
    const moved = await call('document.movePath', {
      projectId,
      fromRelPath: 'x.txt',
      toRelPath: 'x.txt',
      toProjectId: 'no-such-project',
    });
    expect(moved.error).toBeDefined();
    // Nothing moved: the row is still where it was.
    expect(
      (await call('document.getState', { projectId, relPath: 'x.txt' })).result.state.languageId,
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

/**
 * `document.setGridColumnWidths` over the pipe (073 FR-040). The daemon validates the widths before
 * the store sees them, so the store only ever holds the declared shape: column index → px, 40–2000.
 * Out-of-range widths are REFUSED (the whole set), not clamped — clamping is the renderer's job.
 */
describe('document.setGridColumnWidths IPC', () => {
  const widthsOf = async (relPath: string): Promise<unknown> =>
    (await call('document.getState', { projectId, relPath })).result.state?.gridColumnWidths;

  it('round-trips a width set, rounding each width, beside the language override', async () => {
    await call('document.setState', { projectId, relPath: 'data.csv', languageId: 'plaintext' });
    const set = await call('document.setGridColumnWidths', {
      projectId,
      relPath: 'data.csv',
      widths: { 0: 40, 3: 120.6, 9999999: 2000 },
    });
    expect(set.error).toBeUndefined();
    expect(set.result.state).toEqual({
      projectId,
      relPath: 'data.csv',
      languageId: 'plaintext',
      gridColumnWidths: { 0: 40, 3: 121, 9999999: 2000 },
    });
    expect(await widthsOf('data.csv')).toEqual({ 0: 40, 3: 121, 9999999: 2000 });
  });

  it('refuses a width outside 40–2000 or a key outside the column-index pattern, and keeps what was stored', async () => {
    await call('document.setGridColumnWidths', { projectId, relPath: 'data.csv', widths: { 1: 90 } });
    const refused: unknown[] = [
      { 1: 39.9 }, // below the floor — checked before rounding, so not rounded up to 40
      { 1: 2000.1 }, // above the ceiling
      { 1: -50 },
      { 1: '100' }, // not a number
      { 1: null },
      { 1: 90, 2: 10 }, // one bad entry refuses the whole set
      { '01': 90 }, // leading zero
      { '-1': 90 },
      { '1.5': 90 },
      { a: 90 },
      { '': 90 },
      { 12345678: 90 }, // eight digits: past the seven-digit cap
      [90], // an array is not a map
      'nope',
      42,
    ];
    for (const widths of refused) {
      const res = await call('document.setGridColumnWidths', { projectId, relPath: 'data.csv', widths });
      expect(res.error?.code, JSON.stringify(widths)).toBe(-32602);
    }
    // Absent `widths` is not `null`: it does not clear.
    expect((await call('document.setGridColumnWidths', { projectId, relPath: 'data.csv' })).error?.code).toBe(-32602);
    expect(await widthsOf('data.csv')).toEqual({ 1: 90 });
  });

  it('null clears the stored widths, and the row goes when no language override remains', async () => {
    await call('document.setState', { projectId, relPath: 'kept.csv', languageId: 'plaintext' });
    await call('document.setGridColumnWidths', { projectId, relPath: 'kept.csv', widths: { 0: 200 } });
    await call('document.setGridColumnWidths', { projectId, relPath: 'bare.csv', widths: { 0: 200 } });

    const cleared = await call('document.setGridColumnWidths', { projectId, relPath: 'kept.csv', widths: null });
    expect(cleared.result.state).toEqual({ projectId, relPath: 'kept.csv', languageId: 'plaintext', gridColumnWidths: null });
    expect((await call('document.getState', { projectId, relPath: 'kept.csv' })).result.state.languageId).toBe('plaintext');

    // language_id NULL and widths '' → the repository deletes the row.
    const gone = await call('document.setGridColumnWidths', { projectId, relPath: 'bare.csv', widths: null });
    expect(gone.result.state).toEqual({ projectId, relPath: 'bare.csv', languageId: null, gridColumnWidths: null });
    expect((await call('document.getState', { projectId, relPath: 'bare.csv' })).result.state).toBeNull();
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM document_state WHERE rel_path = 'bare.csv'`).get(),
    ).toEqual({ n: 0 });
  });

  it('an empty width map clears exactly as null does', async () => {
    await call('document.setGridColumnWidths', { projectId, relPath: 'e.csv', widths: { 2: 300 } });
    const res = await call('document.setGridColumnWidths', { projectId, relPath: 'e.csv', widths: {} });
    expect(res.error).toBeUndefined();
    expect((await call('document.getState', { projectId, relPath: 'e.csv' })).result.state).toBeNull();
  });

  it('drops a stored widths value that no longer parses, or no longer has the declared shape, keeping the row', async () => {
    // Written straight to the store, past the daemon's validation — what an older build or a damaged
    // file could leave behind.
    const repo = new DocumentStateRepository(db);
    repo.set('alice', projectId, 'broken.csv', 'plaintext');
    repo.setGridColumnWidths('alice', projectId, 'broken.csv', '{not json');
    repo.setGridColumnWidths('alice', projectId, 'stale.csv', '{"0":5}');

    const broken = await call('document.getState', { projectId, relPath: 'broken.csv' });
    expect(broken.error).toBeUndefined();
    expect(broken.result.state).toEqual({ projectId, relPath: 'broken.csv', languageId: 'plaintext', gridColumnWidths: null });
    const stale = await call('document.getState', { projectId, relPath: 'stale.csv' });
    expect(stale.error).toBeUndefined();
    expect(stale.result.state).toEqual({ projectId, relPath: 'stale.csv', languageId: null, gridColumnWidths: null });

    // Reading never rewrites the stored value; the next valid write replaces it.
    expect(repo.get('alice', projectId, 'broken.csv')?.gridColumnWidths).toBe('{not json');
    await call('document.setGridColumnWidths', { projectId, relPath: 'broken.csv', widths: { 0: 80 } });
    expect(await widthsOf('broken.csv')).toEqual({ 0: 80 });
  });
});
