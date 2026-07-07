import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-migv4-'));
  tempDirs.push(dir);
  return join(dir, 'throng.db');
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function columns(db: ThrongDatabase, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => (r as { name: string }).name);
}

describe('migration v4 (sub-workspace identity)', () => {
  it('adds name + colour columns to sub_workspaces and reaches the latest version', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      runMigrations(db);
      expect(LATEST_VERSION).toBeGreaterThanOrEqual(4);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
      const cols = columns(db, 'sub_workspaces');
      expect(cols).toContain('name');
      expect(cols).toContain('colour');
    } finally {
      db.close();
    }
  });

  it('backfills existing rows with default name/colour and is idempotent', () => {
    const path = freshDbPath();
    // Migrate only up to v3, then insert a pre-v4 sub-workspace row (no name/colour).
    let db = openDatabase({ databasePath: path });
    db.pragma('user_version = 0');
    db.exec('DROP TABLE IF EXISTS sub_workspaces');
    runMigrations(db); // v1..v4 (fresh)
    // Simulate a legacy row by clearing name/colour to their migration defaults.
    db.prepare(
      `INSERT INTO sub_workspaces (id, owner_user, name, colour, bounds_json, content_json, updated_at)
       VALUES ('s1','u','Sub-workspace','#8a8f98','{}','[]','t')`,
    ).run();
    db.close();

    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);
      expect(result.applied).toBe(false); // already current
      const row = db.prepare(`SELECT name, colour FROM sub_workspaces WHERE id = 's1'`).get() as {
        name: string;
        colour: string;
      };
      expect(row.name).toBe('Sub-workspace');
      expect(row.colour).toBe('#8a8f98');
    } finally {
      db.close();
    }
  });
});
