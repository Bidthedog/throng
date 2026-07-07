import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, LATEST_VERSION } from '@throng/persistence';
import type { ThrongDatabase } from '@throng/persistence';

const tempDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-drift-'));
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

/**
 * Regression for the "can no longer create sub-workspaces" defect: a developer DB
 * left half-migrated by an intermediate build — stamped to the LATEST
 * `user_version` (so the version-keyed runner short-circuits) yet missing columns a
 * later-renumbered migration was meant to add. The schema guard must reconcile this
 * drift on the next run so persistence works again.
 */
describe('schema-drift repair (migration safety net)', () => {
  it('heals a DB stamped to LATEST but missing sub_workspaces name/colour columns', () => {
    const path = freshDbPath();

    // Build the exact drifted shape: base + position, but NO name/colour, then
    // stamp user_version to LATEST so a naive version-keyed runner does nothing.
    let db = openDatabase({ databasePath: path });
    db.exec('DROP TABLE IF EXISTS sub_workspaces');
    db.exec(`
      CREATE TABLE sub_workspaces (
        id           TEXT PRIMARY KEY,
        owner_user   TEXT NOT NULL,
        bounds_json  TEXT NOT NULL,
        content_json TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.pragma(`user_version = ${LATEST_VERSION}`);
    expect(columns(db, 'sub_workspaces')).not.toContain('name');
    db.close();

    // Re-open and run migrations: the guard should add the missing columns even
    // though the version is already current.
    db = openDatabase({ databasePath: path });
    try {
      const result = runMigrations(db);

      const cols = columns(db, 'sub_workspaces');
      expect(cols).toContain('name');
      expect(cols).toContain('colour');
      expect(result.repairs).toEqual(
        expect.arrayContaining([
          { table: 'sub_workspaces', column: 'name' },
          { table: 'sub_workspaces', column: 'colour' },
        ]),
      );

      // The whole point: a persist-shaped insert now succeeds instead of throwing
      // "no such column: name".
      expect(() =>
        db
          .prepare(
            `INSERT INTO sub_workspaces
               (id, owner_user, name, colour, bounds_json, content_json, updated_at, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('s1', 'u', 'Sub-workspace 1', '#6aa3ff', '{}', '[]', 't', 0),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('is a no-op (no repairs) on a healthy, fully-migrated DB', () => {
    const db = openDatabase({ databasePath: freshDbPath() });
    try {
      const result = runMigrations(db);
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
      expect(result.repairs).toEqual([]);
    } finally {
      db.close();
    }
  });
});
