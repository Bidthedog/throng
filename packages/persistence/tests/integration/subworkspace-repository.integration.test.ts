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
});
