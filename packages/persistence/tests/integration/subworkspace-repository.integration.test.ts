import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type SubWorkspace } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  WorkspaceRepository,
  SubWorkspaceRepository,
} from '@throng/persistence';

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-subrepo-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeSub(id: string, name: string, colour: string): SubWorkspace {
  const layout = createDefaultLayout('p1', { tab: `${id}-t`, panel: `${id}-p` });
  return {
    id,
    ownerUser: 'u',
    name,
    colour,
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    tabs: layout.tabs,
  };
}

describe('SubWorkspaceRepository', () => {
  it('lists metadata, hydrates full records, and round-trips rename/recolour/delete', () => {
    const path = freshDbPath();
    let db = openDatabase({ databasePath: path });
    runMigrations(db);
    const ws = new WorkspaceRepository(db);
    let sub = new SubWorkspaceRepository(db);

    ws.persistSubWorkspaces('u', [makeSub('s1', 'Alpha', '#ffffff'), makeSub('s2', 'Beta', '#000000')]);

    // list = metadata only.
    expect(sub.list('u').map((m) => ({ id: m.id, name: m.name, colour: m.colour }))).toEqual([
      { id: 's1', name: 'Alpha', colour: '#ffffff' },
      { id: 's2', name: 'Beta', colour: '#000000' },
    ]);

    // get = full record with tabs + bounds.
    const full = sub.get('u', 's1');
    expect(full?.name).toBe('Alpha');
    expect(full?.bounds.width).toBe(300);
    expect(full?.tabs.length).toBeGreaterThanOrEqual(1);

    sub.rename('u', 's1', 'Renamed');
    sub.recolour('u', 's1', '#123456');
    sub.delete('u', 's2');
    db.close();

    // Reopen to prove durability.
    db = openDatabase({ databasePath: path });
    sub = new SubWorkspaceRepository(db);
    try {
      const list = sub.list('u');
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: 's1', name: 'Renamed', colour: '#123456' });
      expect(sub.get('u', 's2')).toBeNull();
    } finally {
      db.close();
    }
  });

  // 052 R3 — a writer that owns one record writes only that record, so it can never put back a stale copy of a
  // sibling another writer has just changed (FR-005).
  describe('per-record writes', () => {
    const rowsOf = (db: ReturnType<typeof openDatabase>) =>
      db.prepare(`SELECT id, position, content_json, updated_at FROM sub_workspaces ORDER BY position`).all() as Array<{
        id: string;
        position: number;
        content_json: string;
        updated_at: string;
      }>;

    it('saveSubWorkspace updates one row in place and leaves its siblings byte-identical', () => {
      const db = openDatabase({ databasePath: freshDbPath() });
      runMigrations(db);
      try {
        const ws = new WorkspaceRepository(db);
        ws.persistSubWorkspaces('u', [makeSub('s1', 'A', '#111111'), makeSub('s2', 'B', '#222222'), makeSub('s3', 'C', '#333333')]);
        const before = rowsOf(db);

        const changed = { ...makeSub('s2', 'B', '#222222'), tabs: makeSub('x', 'X', '#000000').tabs };
        ws.saveSubWorkspace('u', changed);

        const after = rowsOf(db);
        expect(after.map((r) => [r.id, r.position])).toEqual([['s1', 0], ['s2', 1], ['s3', 2]]);
        expect(after[0]).toEqual(before[0]);
        expect(after[2]).toEqual(before[2]);
        expect(ws.loadSubWorkspaces('u').find((s) => s.id === 's2')!.tabs).toEqual(changed.tabs);
      } finally {
        db.close();
      }
    });

    it('saveSubWorkspace appends a new id last', () => {
      const db = openDatabase({ databasePath: freshDbPath() });
      runMigrations(db);
      try {
        const ws = new WorkspaceRepository(db);
        ws.persistSubWorkspaces('u', [makeSub('s1', 'A', '#111111'), makeSub('s2', 'B', '#222222')]);
        ws.saveSubWorkspace('u', makeSub('s9', 'Z', '#999999'));
        expect(ws.loadSubWorkspaces('u').map((s) => s.id)).toEqual(['s1', 's2', 's9']);
      } finally {
        db.close();
      }
    });

    it('deleteSubWorkspaces removes only the named ids and reports what it removed', () => {
      const db = openDatabase({ databasePath: freshDbPath() });
      runMigrations(db);
      try {
        const ws = new WorkspaceRepository(db);
        ws.persistSubWorkspaces('u', [makeSub('s1', 'A', '#111111'), makeSub('s2', 'B', '#222222'), makeSub('s3', 'C', '#333333')]);
        const before = rowsOf(db);
        expect(ws.deleteSubWorkspaces('u', ['s2', 'nope'])).toEqual(['s2']);
        expect(rowsOf(db)).toEqual([before[0], before[2]]);
      } finally {
        db.close();
      }
    });

    it('atomically runs its body in one transaction: a throw rolls every write back', () => {
      const db = openDatabase({ databasePath: freshDbPath() });
      runMigrations(db);
      try {
        const ws = new WorkspaceRepository(db);
        ws.persistSubWorkspaces('u', [makeSub('s1', 'A', '#111111')]);
        expect(() =>
          ws.atomically(() => {
            ws.saveSubWorkspace('u', makeSub('s2', 'B', '#222222'));
            throw new Error('boom');
          }),
        ).toThrow('boom');
        expect(ws.loadSubWorkspaces('u').map((s) => s.id)).toEqual(['s1']);
      } finally {
        db.close();
      }
    });
  });
});
