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
  LATEST_VERSION,
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

/**
 * Creating a sub-workspace on a DRIFTED database — the reported defect, at the layer that owns it.
 *
 * PLACE AT: `packages/daemon/tests/integration/subworkspace-drift-create.integration.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/subworkspace-drift-heal.e2e.ts:14` (034 FR-045), which was a
 * whole spec file with its own seeded `runOwnApp` launch.
 *
 * ══ WHY THE EXISTING INTEGRATION TEST WAS NOT ENOUGH ══
 *
 * `packages/persistence/tests/integration/migration-drift-repair.integration.test.ts:33` seeds the
 * byte-identical drifted shape and proves the guard adds `name` and `colour`. It then proves a
 * "persist-shaped insert" succeeds — but that INSERT is HAND-WRITTEN in the test, so it is the
 * test's own column list that is being checked against the healed table, not the repository's. If
 * `WorkspaceRepository` wrote a column the guard did not restore, or `SubWorkspaceRepository.list`
 * selected one, that test would still be green and creating a sub-workspace would still fail.
 *
 * So what is added here is the REAL path, end to end within the daemon: the same startup order
 * `packages/daemon/src/main.ts:110` uses (`openDatabase` then `runMigrations`), then the actual
 * `workspace.persistSubWorkspaces` and `subworkspace.list` RPCs over a real named pipe. That is the
 * whole of what the E2E was reaching for — its own final assertion was a sidebar row reading the
 * result of `subworkspace.list`.
 *
 * ══ WHAT DOES NOT MOVE HERE ══
 *
 * The sidebar RENDERING the returned row, and the absence of `subworkspace-error`. Those are the
 * renderer's, they are not about drift, and they are exercised by every other sub-workspace spec.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `runMigrations(db)` call in `beforeEach` below. The drifted table is then never healed,
 * `workspace.persistSubWorkspaces` fails on `no such column: name`, and BOTH tests in this file
 * fail. A test that passed without the migration having run would be asserting nothing about drift.
 */

let counter = 0;
const uniquePipeName = (): string => `\\\\.\\pipe\\throng-drift-${process.pid}-${(counter += 1)}`;
const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };

let server: IpcServer;
let db: ThrongDatabase;
let dataDir: string;
let pipeName: string;
let projectId: string;
let repairs: { table: string; column: string }[];

/** Every column the shipped table has EXCEPT `name` and `colour` — the exact drifted shape. */
function seedDrift(databasePath: string): void {
  const seed = openDatabase({ databasePath });
  try {
    // The full schema first, so the drift is a MISSING PAIR OF COLUMNS rather than a missing
    // database — this is what `packages/ui/tests/e2e/harness.ts:90` (`seedDatabase`) did for the
    // migrated spec, and the difference matters: a naive runner short-circuits only when the
    // version is already current.
    runMigrations(seed);
    seed.exec('DROP TABLE IF EXISTS sub_workspaces');
    seed.exec(`
      CREATE TABLE sub_workspaces (
        id           TEXT PRIMARY KEY,
        owner_user   TEXT NOT NULL,
        bounds_json  TEXT NOT NULL,
        content_json TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_subws_owner ON sub_workspaces(owner_user);
    `);
    // Stamped CURRENT, which is the whole trap: a version-keyed runner sees nothing to do.
    seed.pragma(`user_version = ${LATEST_VERSION}`);
  } finally {
    seed.close();
  }
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-driftcreate-'));
  const databasePath = join(dataDir, 'throng.db');
  seedDrift(databasePath);

  // The daemon's own startup order (`packages/daemon/src/main.ts:110`).
  db = openDatabase({ databasePath });
  repairs = runMigrations(db).repairs;

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

/** What the renderer's detach path sends: the whole set, replacing whatever is stored. */
function detached(id: string, name: string, colour: string): unknown {
  return {
    id,
    ownerUser: 'alice',
    name,
    colour,
    bounds: { x: 120, y: 120, width: 900, height: 640 },
    tabs: [
      {
        id: `${id}-t`,
        title: 'Sub-workspace Tab 1',
        root: { type: 'panel', id: `${id}-p`, originProjectId: projectId, title: 'P' },
      },
    ],
  };
}

describe('creating a sub-workspace on a schema-drifted database', () => {
  it('heals the drift on startup, then persists and lists the new sub-workspace', async () => {
    /*
     * The E2E's claim, whole: a database that an intermediate build left stamped-but-incomplete
     * does not make every detach fail silently. The repair is asserted first so a green list below
     * cannot be read as "the drift was never there".
     */
    expect(repairs).toEqual(
      expect.arrayContaining([
        { table: 'sub_workspaces', column: 'name' },
        { table: 'sub_workspaces', column: 'colour' },
      ]),
    );

    const persisted = await call('workspace.persistSubWorkspaces', {
      subWorkspaces: [detached('s1', 'Sub-workspace 1', '#6aa3ff')],
    });
    // Asserted rather than assumed: before the guard this returned a `no such column: name` error
    // and the renderer swallowed it, which is exactly why the defect read as "nothing happens".
    expect(persisted.error, `persist failed: ${JSON.stringify(persisted.error ?? null)}`).toBeUndefined();

    // `SubWorkspaceRepository.list` SELECTs `name` and `colour` by name, so this reads the healed
    // columns back through the same query the sidebar's row is built from.
    const listed = await call('subworkspace.list', {});
    expect(listed.result.subWorkspaces).toEqual([
      { id: 's1', name: 'Sub-workspace 1', colour: '#6aa3ff', tabCount: 1, panelCount: 1 },
    ]);
  });

  it('the healed row survives a reopen — the repair is in the schema, not in the session', async () => {
    /*
     * Without this, a "repair" that only added the columns to an in-memory handle would pass the
     * test above and lose the user's sub-workspace on the next daemon start. It is also the half
     * the migrated E2E could not assert at all: it never restarted the app.
     */
    await call('workspace.persistSubWorkspaces', {
      subWorkspaces: [detached('s1', 'Sub-workspace 1', '#6aa3ff')],
    });
    const path = join(dataDir, 'throng.db');
    db.close();

    db = openDatabase({ databasePath: path });
    const again = runMigrations(db);
    expect(again.repairs).toEqual([]); // nothing left to heal
    expect(new SubWorkspaceRepository(db).list('alice')).toEqual([
      { id: 's1', name: 'Sub-workspace 1', colour: '#6aa3ff', tabCount: 1, panelCount: 1 },
    ]);
  });
});
