import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService, type IUserContext } from '@throng/core';
import { openDatabase, runMigrations, ProjectRepository, type ThrongDatabase } from '@throng/persistence';
import { ProjectIpcService } from '../../src/project-service.js';
import { CMD, rpcCall, startTerminalDaemon, waitFor, type TerminalDaemon } from './terminal-harness.js';

/**
 * 051 FR-022 — #468 reproduced at the daemon: Unload with End Terminals on a project with several
 * running terminals, then an immediate switch to another project.
 *
 * Layer: integration — the defect is the daemon's one event loop waiting on real OS processes while
 * it ends terminals; a fake host never waits, so nothing below this layer can fail for the reason.
 *
 * The switch is `projects.setActive`, served by the SAME event loop that ends the terminals. UI main
 * gives it the 2 s ping timeout, and the user sees the switch fail and revert whenever the daemon
 * spends longer than that ending terminals. The bound here is FR-022's 1 s, measured from the moment
 * `setActive` is sent while `killAll` is in flight, not awaited — exactly as the renderer's Unload
 * leaves it while the user clicks the next project.
 *
 * Three rounds in one test, sharing one daemon and database (`[derived]` from SC-001, whose twenty
 * consecutive attempts the manual test plan covers). Each round starts four real shells, which is
 * what makes this file slow (~10 s); one round would miss an intermittent stall, more would only
 * repeat the same evidence.
 */

const userContext: IUserContext = { currentUser: () => ({ userId: 'u', userName: 'U' }) };
const TERMINALS = 4;
const ROUNDS = 3;
const SWITCH_BOUND_MS = 1000;

let daemon: TerminalDaemon;
let db: ThrongDatabase;
let dataDir: string;
let rootA: string;
let rootB: string;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  dataDir = mkdtempSync(join(tmpdir(), 'throng-468-db-'));
  rootA = mkdtempSync(join(tmpdir(), 'throng-468-a-'));
  rootB = mkdtempSync(join(tmpdir(), 'throng-468-b-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  const projects = new ProjectService({
    store: new ProjectRepository(db),
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  new ProjectIpcService(projects).register(daemon.router);
});

afterEach(async () => {
  try {
    await rpcCall(daemon.pipeName, 'terminal.killAll', {});
    await waitFor(
      async () => (await rpcCall(daemon.pipeName, 'terminal.list', {})).result.sessions.length === 0,
      20_000,
      'every session to exit before the temp dirs are removed',
    );
  } catch {
    /* server may already be stopping */
  }
  await daemon.stop();
  db.close();
  for (const dir of [dataDir, rootA, rootB]) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function createProject(name: string, rootFolder: string): Promise<string> {
  const created = await rpcCall(daemon.pipeName, 'projects.create', { name, colour: '#336699', rootFolder });
  return created.result.project.id as string;
}

async function startBusyTerminals(projectId: string, round: number): Promise<void> {
  for (let i = 0; i < TERMINALS; i += 1) {
    const panelId = `p${round}-${i}`;
    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId,
      projectId,
      launch: { file: CMD, args: [], cwd: rootA },
      cols: 80,
      rows: 24,
    });
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId, data: 'ping -n 60 127.0.0.1\r\n' });
  }
}

describe('051 FR-022 — a switch straight after Unload with End Terminals (#468)', () => {
  it(`answers projects.setActive within ${SWITCH_BOUND_MS} ms while the unloaded project's terminals end`, async () => {
    const a = await createProject('A', rootA);
    const b = await createProject('B', rootB);

    for (let round = 0; round < ROUNDS; round += 1) {
      await rpcCall(daemon.pipeName, 'projects.setActive', { id: a });
      await startBusyTerminals(a, round);

      // Unload: end A's terminals, NOT awaited — the renderer has already released A by now.
      const unload = rpcCall(daemon.pipeName, 'terminal.killAll', { projectId: a });

      const sent = performance.now();
      const switched = await rpcCall(daemon.pipeName, 'projects.setActive', { id: b });
      const elapsed = performance.now() - sent;

      expect(switched.error, `round ${round}: setActive errored`).toBeUndefined();
      expect(elapsed, `round ${round}: setActive round trip (ms)`).toBeLessThan(SWITCH_BOUND_MS);

      await unload;
      await waitFor(
        async () => (await rpcCall(daemon.pipeName, 'terminal.list', { projectId: a })).result.sessions.length === 0,
        20_000,
        `round ${round}: A's terminals to exit`,
      );
    }
  }, 120_000);
});
