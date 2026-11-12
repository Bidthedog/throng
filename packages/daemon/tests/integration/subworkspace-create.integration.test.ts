// Layer: integration. "Survives a restart" is a claim about the real store.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUBWORKSPACE_PALETTE, type IUserContext } from '@throng/core';
import { SUBWORKSPACE_CREATE_METHOD } from '@throng/ipc-contract';
import { openDatabase, runMigrations, SubWorkspaceRepository, WorkspaceRepository, type ThrongDatabase } from '@throng/persistence';
import { RpcRouter } from '../../src/rpc-router.js';
import { SubWorkspaceIpcService } from '../../src/subworkspace-service.js';

const userContext: IUserContext = { currentUser: () => ({ userId: 'alice', userName: 'Alice' }) };
let dir: string;
let dbPath: string;
let db: ThrongDatabase;
let create: () => { id: string; name: string; colour: string; tabCount: number; panelCount: number };

function open(): void {
  db = openDatabase({ databasePath: dbPath });
  runMigrations(db);
  const router = new RpcRouter();
  new SubWorkspaceIpcService({
    store: new SubWorkspaceRepository(db),
    workspaceStore: new WorkspaceRepository(db),
    userContext,
  }).register(router);
  const handler = (router as unknown as { handlers: Map<string, (p: unknown) => unknown> }).handlers.get(SUBWORKSPACE_CREATE_METHOD)!;
  create = () => handler({}) as ReturnType<typeof create>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'throng-subws-create-'));
  dbPath = join(dir, 'throng.db');
  open();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('subworkspace.create (067 FR-083, FR-084, FR-086)', () => {
  it('makes one sub-workspace holding exactly one untyped panel it owns', () => {
    const meta = create();
    expect(meta).toMatchObject({ tabCount: 1, panelCount: 1 });
    const sub = new SubWorkspaceRepository(db).get('alice', meta.id)!;
    expect(sub.tabs).toHaveLength(1);
    const panel = sub.tabs[0]!.root as { type: string; originProjectId: string; config?: unknown };
    expect(panel.type).toBe('panel');
    expect(panel.originProjectId).toBe(`subworkspace:${meta.id}`);
    expect(panel.config).toBeUndefined();
  });

  it('seeds a distinct default name and an unused palette colour', () => {
    const first = create();
    const second = create();
    expect(second.name).not.toBe(first.name);
    expect(SUBWORKSPACE_PALETTE).toContain(first.colour);
    expect(second.colour).not.toBe(first.colour);
  });

  it('survives a restart', () => {
    const meta = create();
    db.close();
    open();
    expect(new SubWorkspaceRepository(db).list('alice').map((m) => m.id)).toContain(meta.id);
  });
});
