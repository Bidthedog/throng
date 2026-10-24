import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService, type IUserContext } from '@throng/core';
import {
  ATTENTION_FLAG_CLEAR_METHOD,
  ATTENTION_FLAG_LIST_METHOD,
  ATTENTION_FLAG_SET_METHOD,
  JSON_RPC_INVALID_PARAMS,
  PROJECTS_DELETE_METHOD,
} from '@throng/ipc-contract';
import {
  AttentionFlagRepository,
  openDatabase,
  ProjectRepository,
  runMigrations,
  type ThrongDatabase,
} from '@throng/persistence';
import { AttentionFlagIpcService } from '../../../daemon/src/attention-flag-service.js';
import { ProjectIpcService } from '../../../daemon/src/project-service.js';
import { RpcRouter } from '../../../daemon/src/rpc-router.js';

/**
 * contracts/daemon-attention.md, round 12: `attention.flagList` / `flagSet` / `flagClear` (FR-125,
 * FR-128). Layer: contract — the wire shape of three methods against the real router and a real
 * SQLite store; a project delete reaching the flag table is wiring no unit test sees.
 */
const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };

let db: ThrongDatabase;
let dir: string;
let router: RpcRouter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-flag-rpc-'));
  db = openDatabase({ databasePath: join(dir, 'throng.db') });
  runMigrations(db);
  const flags = new AttentionFlagRepository(db);
  const projects = new ProjectService({
    store: new ProjectRepository(db),
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  router = new RpcRouter();
  new AttentionFlagIpcService(flags).register(router);
  new ProjectIpcService(
    projects,
    undefined,
    undefined,
    undefined,
    undefined,
    (projectId) => flags.clearProject(projectId),
  ).register(router);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let id = 0;
async function call(method: string, params?: unknown): Promise<any> {
  return router.handle({ jsonrpc: '2.0', id: ++id, method, params } as never);
}

const entry = (panelId: string, projectId = 'p1') => ({
  panelId,
  projectId,
  panelTitle: 'Build',
  tabTitle: 'Tab',
  projectName: 'Proj',
  raisedAt: 1234,
});

describe('attention.flag* RPC', () => {
  it('lists nothing, sets, upserts by panelId and lists { flags }', async () => {
    expect((await call(ATTENTION_FLAG_LIST_METHOD)).result).toEqual({ flags: [] });
    expect((await call(ATTENTION_FLAG_SET_METHOD, entry('a'))).result).toEqual({ ok: true });
    await call(ATTENTION_FLAG_SET_METHOD, { ...entry('a'), panelTitle: 'Renamed' });
    const listed = (await call(ATTENTION_FLAG_LIST_METHOD)).result.flags;
    expect(listed).toEqual([{ ...entry('a'), panelTitle: 'Renamed' }]);
  });

  it('clears by panelId, and a missing row is not an error', async () => {
    await call(ATTENTION_FLAG_SET_METHOD, entry('a'));
    expect((await call(ATTENTION_FLAG_CLEAR_METHOD, { panelId: 'a' })).result).toEqual({ ok: true });
    expect((await call(ATTENTION_FLAG_CLEAR_METHOD, { panelId: 'a' })).result).toEqual({ ok: true });
    expect((await call(ATTENTION_FLAG_LIST_METHOD)).result.flags).toEqual([]);
  });

  it('refuses a malformed entry with the ordinary invalid-params error and stores nothing', async () => {
    for (const bad of [undefined, null, 'x', { ...entry('a'), panelId: '' }, { ...entry('a'), raisedAt: 'now' }, { panelId: 'a' }]) {
      const res = await call(ATTENTION_FLAG_SET_METHOD, bad);
      expect(res.error?.code).toBe(JSON_RPC_INVALID_PARAMS);
    }
    expect((await call(ATTENTION_FLAG_CLEAR_METHOD, {})).error?.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect((await call(ATTENTION_FLAG_LIST_METHOD)).result.flags).toEqual([]);
  });

  it("deleting a project deletes that project's flags and no others", async () => {
    const project = (
      await call('projects.create', { name: 'P', colour: '#6aa3ff', rootFolder: 'C:/code/p' })
    ).result.project;
    await call(ATTENTION_FLAG_SET_METHOD, entry('a', project.id));
    await call(ATTENTION_FLAG_SET_METHOD, entry('b', 'other'));
    await call(PROJECTS_DELETE_METHOD, { id: project.id });
    const ids = (await call(ATTENTION_FLAG_LIST_METHOD)).result.flags.map((f: { panelId: string }) => f.panelId);
    expect(ids).toEqual(['b']);
  });
});
